import { createHmac, randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import { createKysely, createPool } from '../db/pool.provider';

interface CliArgs {
  users: number;
  rounds: number;
  seed: number;
  concurrency: number;
  baseUrl: string;
  initialBalance: number;
  tolerance: number;
}

const EXPECTED_RTP = 0.95;
const WIN_MULTIPLIER_CAP = 1.9; // Uniform(0, 1.9) gives mean=0.95 with manageable variance.

async function main(): Promise<void> {
  loadEnv();

  const databaseUrl = process.env.DATABASE_URL;
  const secret = process.env.BET_PROCESSOR_HMAC_SECRET ?? 'test';
  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));
  const userIds = await ensureUsers(databaseUrl, args);

  const start = new Date();
  console.log(
    `starting ${args.rounds} rounds over ${userIds.length} users ` +
      `(concurrency=${args.concurrency}, seed=${args.seed})`,
  );

  let nextIdx = 0;
  let completed = 0;
  let appliedBet = 0n;
  let appliedWin = 0n;
  let failures = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = nextIdx++;
      if (i >= args.rounds) {
        return;
      }
      const rng = seededPrng(args.seed, i);
      const userId = userIds[Math.floor(rng() * userIds.length)];
      const bet = Math.floor(rng() * 9900) + 100;
      const win = drawWin(rng, bet);

      const outcome = await postRound(args.baseUrl, secret, userId, bet, win);
      if (outcome.ok) {
        appliedBet += BigInt(bet);
        appliedWin += BigInt(win);
      } else {
        failures++;
      }
      completed++;
      if (completed % 500 === 0) {
        process.stdout.write(
          `  ${completed}/${args.rounds} (failures=${failures})\r`,
        );
      }
    }
  }

  await Promise.all(
    Array.from({ length: args.concurrency }, () => worker()),
  );

  const end = new Date();
  const elapsedSec = (end.getTime() - start.getTime()) / 1000;
  process.stdout.write('\n');
  console.log(
    `completed in ${elapsedSec.toFixed(1)}s (${(completed / elapsedSec).toFixed(0)} rounds/s, failures=${failures})`,
  );

  const observedRtp =
    appliedBet === 0n ? 0 : Number(appliedWin) / Number(appliedBet);
  console.log(
    `  client-side: bet=${appliedBet} win=${appliedWin} rtp=${observedRtp.toFixed(4)}`,
  );

  const reportRtp = await fetchCasinoRtp(args.baseUrl, secret, start, end);
  console.log(`  reported   : rtp=${reportRtp.toFixed(4)}`);

  const drift = Math.abs(reportRtp - EXPECTED_RTP);
  if (drift > args.tolerance) {
    console.error(
      `FAIL: |${reportRtp.toFixed(4)} - ${EXPECTED_RTP}| = ${drift.toFixed(4)} > ${args.tolerance}`,
    );
    process.exit(1);
  }
  console.log(
    `PASS: RTP ${reportRtp.toFixed(4)} within +/- ${args.tolerance} of ${EXPECTED_RTP}`,
  );
}

async function ensureUsers(
  databaseUrl: string,
  args: CliArgs,
): Promise<string[]> {
  const pool = createPool({ databaseUrl });
  const db = createKysely(pool);
  const prng = seededPrng(args.seed, -1);

  const users: Array<{ id: string; balance: bigint }> = [];
  for (let i = 0; i < args.users; i++) {
    const balance = Math.floor(prng() * args.initialBalance) + 10_000;
    users.push({
      id: `sim-${i.toString().padStart(6, '0')}`,
      balance: BigInt(balance),
    });
  }

  const CHUNK = 500;
  await db.transaction().execute(async (trx) => {
    for (let i = 0; i < users.length; i += CHUNK) {
      const chunk = users.slice(i, i + CHUNK);
      await trx
        .insertInto('users')
        .values(chunk.map((u) => ({ id: u.id, currency: 'USD' })))
        .onConflict((oc) => oc.column('id').doNothing())
        .execute();
      await trx
        .insertInto('user_balances')
        .values(
          chunk.map((u) => ({
            user_id: u.id,
            currency: 'USD',
            balance: u.balance,
          })),
        )
        .onConflict((oc) =>
          oc.column('user_id').doUpdateSet((eb) => ({
            balance: eb.ref('excluded.balance'),
          })),
        )
        .execute();
    }
  });

  await db.destroy();
  return users.map((u) => u.id);
}

async function postRound(
  baseUrl: string,
  secret: string,
  userId: string,
  bet: number,
  win: number,
): Promise<{ ok: boolean }> {
  const actions: Array<Record<string, unknown>> = [
    { action: 'bet', action_id: randomUUID(), amount: bet },
  ];
  if (win > 0) {
    actions.push({ action: 'win', action_id: randomUUID(), amount: win });
  }
  const body = JSON.stringify({
    user_id: userId,
    currency: 'USD',
    game: 'simulator:default',
    game_id: randomUUID(),
    finished: true,
    actions,
  });
  const sig = createHmac('sha256', secret).update(body).digest('hex');
  const res = await fetch(`${baseUrl}/aggregator/takehome/process`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `HMAC-SHA256 ${sig}`,
    },
    body,
  });
  return { ok: res.ok };
}

async function fetchCasinoRtp(
  baseUrl: string,
  secret: string,
  from: Date,
  to: Date,
): Promise<number> {
  const url = `${baseUrl}/aggregator/takehome/report/casino?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
  const sig = createHmac('sha256', secret).update('').digest('hex');
  const res = await fetch(url, {
    headers: { authorization: `HMAC-SHA256 ${sig}` },
  });
  if (!res.ok) {
    throw new Error(`report fetch failed: ${res.status}`);
  }
  const json = (await res.json()) as {
    currencies: Array<{ currency: string; rtp: number | null }>;
  };
  const usd = json.currencies.find((c) => c.currency === 'USD');
  return usd?.rtp ?? 0;
}

function drawWin(rng: () => number, bet: number): number {
  // Uniform multiplier in [0, WIN_MULTIPLIER_CAP] gives an unbiased estimator
  // of EXPECTED_RTP per round with per-round sigma roughly 0.55 * bet —
  // enough variance to be non-trivial, low enough to converge within ±1%
  // over ~10k rounds.
  const multiplier = rng() * WIN_MULTIPLIER_CAP;
  return Math.round(multiplier * bet);
}

function seededPrng(seed: number, roundIdx: number): () => number {
  // Each round gets its own PRNG seeded deterministically from (seed,
  // roundIdx). This makes the runner reproducible regardless of how rounds
  // are interleaved across workers.
  let a = (seed ^ Math.imul(roundIdx, 0x9e3779b9)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    users: 1000,
    rounds: 10_000,
    seed: 42,
    concurrency: 20,
    baseUrl: process.env.API_BASE_URL ?? 'http://localhost:3000',
    initialBalance: 10_000_000,
    tolerance: 0.01,
  };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const next = argv[i + 1];
    if (!next) continue;
    if (key === '--users') out.users = Number(next);
    else if (key === '--rounds') out.rounds = Number(next);
    else if (key === '--seed') out.seed = Number(next);
    else if (key === '--concurrency') out.concurrency = Number(next);
    else if (key === '--base-url') out.baseUrl = next;
    else if (key === '--initial-balance') out.initialBalance = Number(next);
    else if (key === '--tolerance') out.tolerance = Number(next);
    else continue;
    i++;
  }
  return out;
}

void main();
