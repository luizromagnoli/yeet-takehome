import { randomUUID } from 'node:crypto';
import { type Transaction, sql } from 'kysely';
import type { ActionDto, ProcessRequestDto } from '../process/dto/process.dto';
import type { Database } from '../db/types';
import { InsufficientFundsError } from './errors';

export interface ProcessedTransaction {
  action_id: string;
  tx_id: string;
}

export interface ProcessActionsResult {
  game_id: string;
  transactions: ProcessedTransaction[];
  balance: bigint;
}

interface RequestContext {
  user_id: string;
  currency: string;
  game: string;
  game_id: string;
  finished: boolean;
}

export async function processActions(
  trx: Transaction<Database>,
  request: ProcessRequestDto,
): Promise<ProcessActionsResult> {
  const actions = request.actions ?? [];
  if (actions.length === 0) {
    throw new Error('processActions called without actions');
  }

  const ctx: RequestContext = {
    user_id: request.user_id,
    currency: request.currency,
    game: request.game ?? '',
    game_id: request.game_id ?? '',
    finished: request.finished === true,
  };

  await trx
    .insertInto('users')
    .values({ id: ctx.user_id, currency: ctx.currency })
    .onConflict((oc) => oc.column('id').doNothing())
    .execute();

  await trx
    .insertInto('user_balances')
    .values({
      user_id: ctx.user_id,
      currency: ctx.currency,
      balance: 0n,
    })
    .onConflict((oc) => oc.column('user_id').doNothing())
    .execute();

  const locked = await trx
    .selectFrom('user_balances')
    .where('user_id', '=', ctx.user_id)
    .select('balance')
    .forUpdate()
    .executeTakeFirstOrThrow();

  let runningBalance: bigint = locked.balance;
  const transactions: ProcessedTransaction[] = [];
  let anyApplied = false;

  for (const action of actions) {
    const newTxId = randomUUID();
    const claim = await trx
      .insertInto('action_idempotency')
      .values({
        user_id: ctx.user_id,
        action_id: action.action_id,
        tx_id: newTxId,
      })
      .onConflict((oc) =>
        oc.columns(['user_id', 'action_id']).doNothing(),
      )
      .returning(['tx_id', 'created_at'])
      .executeTakeFirst();

    if (!claim) {
      const existing = await trx
        .selectFrom('action_idempotency')
        .where('user_id', '=', ctx.user_id)
        .where('action_id', '=', action.action_id)
        .select('tx_id')
        .executeTakeFirstOrThrow();
      transactions.push({ action_id: action.action_id, tx_id: existing.tx_id });
      continue;
    }

    transactions.push({ action_id: action.action_id, tx_id: claim.tx_id });

    const { delta, applied } = await applyAction(
      trx,
      ctx,
      action,
      claim.tx_id,
      runningBalance,
    );
    runningBalance += delta;
    if (applied) {
      anyApplied = true;
    }
  }

  await trx
    .updateTable('user_balances')
    .where('user_id', '=', ctx.user_id)
    .set({ balance: runningBalance, updated_at: new Date() })
    .execute();

  if (ctx.finished && anyApplied) {
    const today = isoDate(new Date());
    await upsertDailyStatsRound(trx, ctx, today);
  }

  return {
    game_id: ctx.game_id,
    transactions,
    balance: runningBalance,
  };
}

interface ApplyOutcome {
  delta: bigint;
  applied: boolean;
}

async function applyAction(
  trx: Transaction<Database>,
  ctx: RequestContext,
  action: ActionDto,
  txId: string,
  runningBalance: bigint,
): Promise<ApplyOutcome> {
  if (action.action === 'rollback') {
    return applyRollback(trx, ctx, action, txId);
  }

  const wasTombstoned = await consumePendingRollback(
    trx,
    ctx.user_id,
    action.action_id,
  );

  if (wasTombstoned) {
    await insertActionRow(trx, ctx, action, txId, 'noop', 0n);
    return { delta: 0n, applied: false };
  }

  const amount = BigInt(action.amount ?? 0);

  if (action.action === 'bet') {
    if (runningBalance < amount) {
      throw new InsufficientFundsError();
    }
    const delta = -amount;
    await insertActionRow(trx, ctx, action, txId, 'applied', delta);
    await bumpDailyStats(trx, ctx, action.action, amount, 'add');
    return { delta, applied: true };
  }

  // win
  await insertActionRow(trx, ctx, action, txId, 'applied', amount);
  await bumpDailyStats(trx, ctx, action.action, amount, 'add');
  return { delta: amount, applied: true };
}

async function applyRollback(
  trx: Transaction<Database>,
  ctx: RequestContext,
  action: ActionDto,
  txId: string,
): Promise<ApplyOutcome> {
  if (!action.original_action_id) {
    throw new Error('rollback action requires original_action_id');
  }

  const originalClaim = await trx
    .selectFrom('action_idempotency')
    .where('user_id', '=', ctx.user_id)
    .where('action_id', '=', action.original_action_id)
    .select(['tx_id', 'created_at'])
    .executeTakeFirst();

  if (!originalClaim) {
    // Pre-rollback: the original hasn't been seen yet. Tombstone it so the
    // later original becomes a noop, and still record this rollback so that
    // retries find the same tx_id.
    await trx
      .insertInto('pending_rollbacks')
      .values({
        user_id: ctx.user_id,
        original_action_id: action.original_action_id,
        rollback_action_id: action.action_id,
        rollback_tx_id: txId,
      })
      .onConflict((oc) =>
        oc.columns(['user_id', 'original_action_id']).doNothing(),
      )
      .execute();

    await insertActionRow(trx, ctx, action, txId, 'applied', 0n);
    return { delta: 0n, applied: true };
  }

  // pg drops sub-millisecond precision when converting timestamptz to JS
  // Date, so we cannot use the claim's exact created_at for equality. A day
  // window is enough to narrow Postgres to a single partition while still
  // resolving the row via (tx_id) inside that partition.
  const claimDay = startOfDayUTC(originalClaim.created_at as Date);
  const claimDayEnd = nextDayUTC(claimDay);

  const original = await trx
    .selectFrom('actions')
    .where('tx_id', '=', originalClaim.tx_id)
    .where('created_at', '>=', claimDay)
    .where('created_at', '<', claimDayEnd)
    .select(['kind', 'status', 'amount', 'balance_delta', 'created_at'])
    .executeTakeFirstOrThrow();

  if (original.status !== 'applied') {
    // Already neutralized (noop or rolled_back) — idempotent zero-delta rollback.
    await insertActionRow(trx, ctx, action, txId, 'applied', 0n);
    return { delta: 0n, applied: true };
  }

  const reverseDelta = -original.balance_delta;

  await trx
    .updateTable('actions')
    .where('tx_id', '=', originalClaim.tx_id)
    .where('created_at', '=', original.created_at)
    .set({ status: 'rolled_back' })
    .execute();

  await insertActionRow(trx, ctx, action, txId, 'applied', reverseDelta);

  // Shift the original's contribution from bets/wins into the rollback
  // counters, on the day the original was recorded.
  const day = isoDate(original.created_at);
  const amount = original.amount ?? 0n;
  if (original.kind === 'bet') {
    await trx
      .updateTable('user_daily_stats')
      .where('user_id', '=', ctx.user_id)
      .where('currency', '=', ctx.currency)
      .where('day', '=', day)
      .set({
        bets: sql<bigint>`bets - ${amount}`,
        rolled_back_bets: sql<bigint>`rolled_back_bets + ${amount}`,
      })
      .execute();
  } else if (original.kind === 'win') {
    await trx
      .updateTable('user_daily_stats')
      .where('user_id', '=', ctx.user_id)
      .where('currency', '=', ctx.currency)
      .where('day', '=', day)
      .set({
        wins: sql<bigint>`wins - ${amount}`,
        rolled_back_wins: sql<bigint>`rolled_back_wins + ${amount}`,
      })
      .execute();
  }

  return { delta: reverseDelta, applied: true };
}

async function consumePendingRollback(
  trx: Transaction<Database>,
  userId: string,
  actionId: string,
): Promise<boolean> {
  const deleted = await trx
    .deleteFrom('pending_rollbacks')
    .where('user_id', '=', userId)
    .where('original_action_id', '=', actionId)
    .returning('rollback_action_id')
    .executeTakeFirst();
  return deleted !== undefined;
}

async function insertActionRow(
  trx: Transaction<Database>,
  ctx: RequestContext,
  action: ActionDto,
  txId: string,
  status: 'applied' | 'noop',
  balanceDelta: bigint,
): Promise<void> {
  await trx
    .insertInto('actions')
    .values({
      tx_id: txId,
      action_id: action.action_id,
      user_id: ctx.user_id,
      currency: ctx.currency,
      game: ctx.game,
      game_id: ctx.game_id,
      kind: action.action,
      amount: action.amount !== undefined ? BigInt(action.amount) : null,
      original_action_id: action.original_action_id ?? null,
      status,
      balance_delta: balanceDelta,
    })
    .execute();
}

async function bumpDailyStats(
  trx: Transaction<Database>,
  ctx: RequestContext,
  kind: 'bet' | 'win',
  amount: bigint,
  _op: 'add',
): Promise<void> {
  void _op;
  const day = isoDate(new Date());
  const insertValues =
    kind === 'bet'
      ? { user_id: ctx.user_id, currency: ctx.currency, day, bets: amount }
      : { user_id: ctx.user_id, currency: ctx.currency, day, wins: amount };

  if (kind === 'bet') {
    await trx
      .insertInto('user_daily_stats')
      .values(insertValues)
      .onConflict((oc) =>
        oc.columns(['user_id', 'currency', 'day']).doUpdateSet({
          bets: sql<bigint>`user_daily_stats.bets + ${amount}`,
        }),
      )
      .execute();
  } else {
    await trx
      .insertInto('user_daily_stats')
      .values(insertValues)
      .onConflict((oc) =>
        oc.columns(['user_id', 'currency', 'day']).doUpdateSet({
          wins: sql<bigint>`user_daily_stats.wins + ${amount}`,
        }),
      )
      .execute();
  }
}

async function upsertDailyStatsRound(
  trx: Transaction<Database>,
  ctx: RequestContext,
  day: string,
): Promise<void> {
  await trx
    .insertInto('user_daily_stats')
    .values({
      user_id: ctx.user_id,
      currency: ctx.currency,
      day,
      rounds: 1,
    })
    .onConflict((oc) =>
      oc.columns(['user_id', 'currency', 'day']).doUpdateSet({
        rounds: sql<number>`user_daily_stats.rounds + 1`,
      }),
    )
    .execute();
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function nextDayUTC(d: Date): Date {
  return new Date(d.getTime() + 86_400_000);
}
