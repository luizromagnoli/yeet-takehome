import { config as loadEnv } from 'dotenv';
import { createKysely, createPool } from '../db/pool.provider';
import { asUserId, type UserId } from '../domain/values/ids';

interface CliArgs {
  users: number;
  balance: number;
  seed: number;
}

const ACCEPTANCE_USER_ID = '8|USDT|USD';
const ACCEPTANCE_USER_BALANCE = 74_322_001;
const ACCEPTANCE_USER_CURRENCY = 'USD';

const CURRENCIES = ['USD', 'EUR', 'GBP'] as const;

async function main(): Promise<void> {
  loadEnv();

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));
  const pool = createPool({ databaseUrl });
  const db = createKysely(pool);
  const prng = mulberry32(args.seed);

  const users: Array<{ id: UserId; currency: string; balance: bigint }> = [
    {
      id: asUserId(ACCEPTANCE_USER_ID),
      currency: ACCEPTANCE_USER_CURRENCY,
      balance: BigInt(ACCEPTANCE_USER_BALANCE),
    },
  ];

  for (let i = 0; i < args.users; i++) {
    const currency = CURRENCIES[i % CURRENCIES.length];
    const balance = Math.floor(prng() * args.balance) + 10_000;
    users.push({
      id: asUserId(
        `user-${currency.toLowerCase()}-${i.toString().padStart(6, '0')}`,
      ),
      currency,
      balance: BigInt(balance),
    });
  }

  const CHUNK = 500;
  await db.transaction().execute(async (trx) => {
    for (let i = 0; i < users.length; i += CHUNK) {
      const chunk = users.slice(i, i + CHUNK);
      await trx
        .insertInto('users')
        .values(chunk.map((u) => ({ id: u.id, currency: u.currency })))
        .onConflict((oc) => oc.column('id').doNothing())
        .execute();
      await trx
        .insertInto('user_balances')
        .values(
          chunk.map((u) => ({
            user_id: u.id,
            currency: u.currency,
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

  const byCurrency = users.reduce<Record<string, number>>((acc, u) => {
    acc[u.currency] = (acc[u.currency] ?? 0) + 1;
    return acc;
  }, {});
  const breakdown = Object.entries(byCurrency)
    .map(([c, n]) => `${c}=${n}`)
    .join(', ');
  console.log(
    `seeded ${users.length} users (${breakdown}; acceptance + ${args.users} generated, seed=${args.seed})`,
  );
  await db.destroy();
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { users: 1000, balance: 10_000_000, seed: 42 };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === '--users' && next) {
      out.users = Number(next);
      i++;
    } else if (key === '--balance' && next) {
      out.balance = Number(next);
      i++;
    } else if (key === '--seed' && next) {
      out.seed = Number(next);
      i++;
    }
  }
  return out;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

void main();
