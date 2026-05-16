# Yeet Casino bet processor

A production-style bet processor that handles bets, wins, rollbacks (including
the pre-rollback case), idempotent retries, HMAC-signed requests, and
time-bounded RTP reporting.

Built with NestJS + Fastify on Node 24 LTS, PostgreSQL 16, and Kysely.

## Requirements

- Docker Desktop (or any OCI engine that speaks `docker compose`)
- Node.js 24 LTS — the project is pinned via `engines` in `package.json` and
  `.nvmrc`. If you use nvm, `nvm use` picks it up.

Postgres listens on host port `5432` and the API on `:3000`. If either is
occupied locally, override the host mapping in `docker-compose.yml` (or set
`PORT=...` for the API) and update `--base-url` for the game runner.

## Quick start (run from the repo root)

```sh
# 1. Pick up Node 24 and install dependencies
nvm use            # honours .nvmrc → Node 24 LTS
npm install

# 2. Start Postgres in the background
docker compose up -d postgres

# Wait for it to become healthy (~5 seconds):
docker inspect --format '{{.State.Health.Status}}' yeet-postgres-1
# rerun until it prints "healthy"

# 3. Set env vars for the local CLIs (the API container reads them from compose)
export DATABASE_URL=postgres://yeet:yeet@localhost:5432/yeet
export BET_PROCESSOR_HMAC_SECRET=test

# 4. Run migrations
npm run migrate

# 5. Build and run the test suite
#    Tests run against a separate `yeet_test` database (created by the
#    postgres init script on first compose up), so they never touch the
#    dev/app data. The test runner re-applies migrations and truncates
#    between cases automatically.
npm run build
npm test           # 23 tests across acceptance / concurrency / HMAC / reporting

# 6. Seed 1000 users in the app DB. The acceptance user 8|USDT|USD is
#    always seeded at balance 74322001 so the PDF scenarios work against a
#    live API. Other users are distributed across USD / EUR / GBP.
npm run seed -- --users 1000

# 7. Start the API — pick ONE of:
#    A) locally, for development
node dist/main.js
#    B) inside Docker, fully containerised (api + postgres come up together;
#       the api container has MIGRATE_ON_BOOT=true so migrations run before
#       it accepts traffic)
docker compose up --build

# 8. With the API running on :3000, run the multi-currency RTP simulator
npm run game -- --users 300 --rounds 30000 --seed 42 --base-url http://localhost:3000
# Distributes simulated users across USD / EUR / GBP, then prints client-side
# and reported per-currency RTP plus PASS/FAIL on ±1% of 0.95 for each.
```

The reviewer-friendly one-shot path (everything in Docker):

```sh
docker compose up --build -d                                   # postgres + api, auto-migrated
DATABASE_URL=postgres://yeet:yeet@localhost:5432/yeet \
  npm run seed -- --users 1000                                 # seed the app DB
npm test                                                       # uses yeet_test, untouched by seed
npm run game -- --users 300 --rounds 30000 --seed 42 --base-url http://localhost:3000
```

### Manual sanity check

The PDF's example HMAC vector verifies against the seeded acceptance user:

```sh
BODY='{"user_id": "8|USDT|USD","currency": "USD","game": "acceptance:test"}'
SIG=$(node -e "console.log(require('crypto').createHmac('sha256','test').update(process.argv[1]).digest('hex'))" "$BODY")
curl -s -X POST http://localhost:3000/aggregator/takehome/process \
  -H 'content-type: application/json' \
  -H "authorization: HMAC-SHA256 $SIG" \
  -d "$BODY"
# → {"balance":74322001}

curl -s http://localhost:3000/health    # → {"status":"ok"}
```

### Reset the database

If you want to start clean:

```sh
docker compose down -v        # drops the postgres_data volume
docker compose up -d postgres
npm run migrate
npm run seed -- --users 1000
```

## API

There is a single processing endpoint plus two reporting endpoints. Every
request must carry `Authorization: HMAC-SHA256 <hex>` where the digest is
`HMAC_SHA256(secret, <raw request body bytes>)`. Missing or invalid signatures
return `403`. The HMAC is verified against the raw bytes that Fastify
received — not a re-serialized body — and compared in constant time.

### `POST /aggregator/takehome/process`

Handles balance lookups when `actions` is absent, otherwise processes
bets/wins/rollbacks in input order under a single Postgres transaction.

- Balance lookup returns `{ "balance": <int> }`.
- Action processing returns `{ "game_id", "transactions": [{action_id, tx_id}], "balance" }`.
- Insufficient funds: HTTP 400 with `{ "code": 100, "message": "..." }`.
- Replayed actions return the original `tx_id` and do not change the balance.

### `GET /aggregator/takehome/report/users?from=&to=&cursor=&limit=`

Per-user RTP over a time window, keyset-paginated by `user_id`. Excludes
rolled-back amounts from `total_bet` / `total_win` and reports them separately
as `rolled_back_bet` and `rolled_back_win`.

### `GET /aggregator/takehome/report/casino?from=&to=`

Casino-wide RTP totals grouped by currency.

## Architecture decisions

### Partitioning in v1, not later

`actions` is RANGE-partitioned monthly on `created_at` from day one.
Idempotency lives in a separate `action_idempotency` table HASH-partitioned
16 ways on `user_id` (Postgres requires the partition key in any unique
constraint on a partitioned table, so a global `UNIQUE(user_id, action_id)`
needs its own table).

I considered shipping an unpartitioned schema and migrating later. The
upfront cost of partitioning today is small — one extra table, ~5% INSERT
overhead, and a `ensurePartitions()` boot hook. The deferred cost grows
non-linearly: backfilling a separate idempotency table at 1B rows takes
hours, validating the constraint takes more hours, and the namespace flip
needs careful coordination. Past ~100M rows the migration becomes a
multi-week project. Doing it now is half a day of engineering with the same
end state, and it bakes the right habits (queries written with partition
keys, per-partition VACUUM, retention as `DETACH PARTITION`) from the start.

### Idempotency at the storage layer

The hot path claims a row in `action_idempotency` with
`INSERT ... ON CONFLICT (user_id, action_id) DO NOTHING RETURNING tx_id`.
A returned row means the action is fresh; an empty result means a previous
attempt already committed and we read its `tx_id` back. Both branches stay
inside the same transaction as the `actions` insert, so the idempotency
record and the ledger cannot drift.

### Per-user serialization with `SELECT FOR UPDATE`

For every request that carries actions, we acquire a row lock on
`user_balances` for the target user before touching anything else. This is
what makes the design correct under concurrency: same-user requests serialize
through the lock; different-user requests proceed in parallel. The lock is
also what closes the "rollback and original arriving simultaneously" race —
whichever transaction wins the lock processes first, and the second
observes the resulting state cleanly.

### Pre-rollback tombstones

`pending_rollbacks` records rollbacks that reference an action we have not
seen yet. When the original later arrives, the algorithm checks this table,
records the action as `status='noop'` with a `delta=0`, and removes the
tombstone. The action still gets a `tx_id` (idempotency on retry stays
intact) but produces no balance effect.

### Kysely over a heavier ORM

The data layer is Kysely + the `pg` driver, not TypeORM or Prisma. The
workload pushed me away from an ORM rather than toward one:

- The schema relies on Postgres-specific features that no ORM models
  declaratively — `PARTITION BY RANGE`, `PARTITION OF`,
  `HASH (MODULUS 16, REMAINDER n)`, `pg_try_advisory_lock`. With an ORM I'd
  drop to raw `queryRunner.query()` for all of these and lose the ORM's
  type-safety benefit anyway.
- The idempotency hot path is a single
  `INSERT ... ON CONFLICT DO NOTHING RETURNING tx_id`. Kysely expresses this
  directly with full type inference on the returned row. TypeORM's query
  builder is awkward with `RETURNING` outside basic insert/update.
- Money is `BIGINT` in Postgres, native `bigint` in Node (via a `pg` INT8
  type parser). Kysely passes this through cleanly; an ORM's own
  column-type coercion would compete with it.
- `db.transaction().execute(trx => …)` gives us a single, obvious primitive
  for the per-user `SELECT … FOR UPDATE` flow. TypeORM's history of
  transaction APIs (EntityManager vs QueryRunner vs `@Transaction()` vs
  `typeorm-transactional`) is friction we don't need.

"Robust" can be misleading here — TypeORM is *broader* (entities, eager/lazy
loading, repository injection, decorator-driven validation), not more
robust. For a ledger that lives close to SQL, the ORM abstractions don't
pay off, and the type inference on its query builder is famously weak. The
trade I'd give up by avoiding TypeORM (`@InjectRepository(User)` ergonomics
and the familiarity of the Nest tutorial stack) is small compared to what
Kysely buys for partitioning + idempotency + atomic transactions.

### Forward-only migrations

Kysely's migrator manages `kysely_migration` and `kysely_migration_lock`
automatically. Migrations are forward-only — no `down()`. This is the
industry norm for ledger systems where reverse migrations are rarely tested
and frequently wrong; rolling back a schema change is done by writing a new
forward migration.

### Money as `BIGINT` minor units

Balances and amounts are stored as `BIGINT` (minor units). The `pg` driver
is configured at module load to return `INT8` as a native JavaScript
`bigint` so arithmetic stays precise across the full range. Values are
converted to `number` only at the JSON response boundary.

### HMAC verification details

`@nestjs/platform-fastify` is configured with `{ rawBody: true }`. The
global `HmacGuard` reads `req.rawBody`, computes `HMAC_SHA256(secret, rawBody)`,
parses the provided hex with strict length checks, and compares with
`crypto.timingSafeEqual`. Any failure path — missing header, wrong scheme,
wrong length, non-hex characters, mismatched bytes — returns `403`. Health
endpoints opt out via a `@SkipHmac()` decorator so health checks don't
need to compute signatures.

## Partition maintenance

`actions` needs partitions covering at least the current month plus the next
few; without them, INSERTs for the new month fail outright. Three safeguards
ensure coverage:

1. `ensurePartitions(monthsAhead=3)` runs on every API boot before the HTTP
   listener accepts traffic.
2. A daily `@Cron('0 3 * * *')` re-runs the same routine. When the service
   is horizontally scaled, the cron body acquires
   `pg_try_advisory_lock(hashtext('ensure_partitions'))` so only one instance
   executes the DDL.
3. A `npm run ensure-partitions` CLI is available for manual remediation.

## Schema (high level)

- `users` — id + currency.
- `user_balances` — id, balance (CHECK ≥ 0), updated_at. Row-locked per user.
- `actions` — append-only ledger, monthly RANGE partitions. PK
  `(tx_id, created_at)` because the partition key must be in the PK; the
  hot-path local index is `(user_id, created_at DESC)`.
- `action_idempotency` — 16 HASH partitions on `user_id`. PK
  `(user_id, action_id)`. Carries `created_at` so the rollback flow can look
  the original action back up in `actions` with partition pruning.
- `pending_rollbacks` — pre-rollback tombstones keyed by
  `(user_id, original_action_id)`.
- `user_daily_stats` — pre-aggregated rollup that keeps RTP queries fast at
  any scale.

## Tests

```sh
npm test
```

Vitest + Fastify's in-process injector against a real Postgres. Covers:
- All PDF acceptance scenarios A–J, including the fixed HMAC vector.
- Concurrency: 50 parallel same-action requests, exactly-once application,
  serialized balance updates that never go negative.
- HMAC negative cases (missing, wrong scheme, wrong length, non-hex).
- Reporting accuracy: totals match a known activity stream; rolled-back
  amounts move out of `total_bet` / `total_win`; keyset pagination is
  stable.

The acceptance suite TRUNCATEs the dev database between tests. Run a
dedicated test database if you want isolation from local development data.

## RTP simulator

```sh
npm run game -- --users 200 --rounds 30000 --seed 42 --base-url http://localhost:3000
```

The simulator seeds users with starting balances, issues bet+win rounds
through the public HTTP API (HMAC-signed), and at the end fetches the
casino RTP report for the run window and asserts `|reported_rtp - 0.95| < tolerance`.

Win amounts are drawn from a `Uniform(0, 1.9 × bet)` distribution. The mean
is exactly `0.95 × bet`, so the expected RTP is `0.95`, but the per-round
variance (sigma ≈ 0.55 × bet) means the observed RTP converges toward 0.95
rather than snapping there — exactly what the spec asks for. With the
default tolerance of `0.01` (±1%), ~10k rounds is enough to converge
reliably. Each round uses an independent PRNG seeded from `(seed, round_idx)`,
so the simulation is deterministic regardless of worker interleaving.

## Assumptions

- A given `user_id` always implies the same currency. The first request
  seeds it; mismatches on later requests are rejected.
- Rollback of a rollback is treated as an idempotent no-op (rollback rows
  are not themselves rollback-able).
- The `finished` flag is informational: when `true` and at least one action
  was applied, the request increments `rounds` in `user_daily_stats` for the
  day.
- Report timestamps are server-side `created_at`. Sub-day precision is
  approximated by truncating the bounds to day boundaries (the rollup is
  per-day); production would extend the report to add a partial-day fallback
  query against `actions` directly for the boundary days.

## Production roadmap (not implemented)

These were deliberately scoped out of v1 — each is a known follow-up with a
clear migration path, not an oversight.

- **AWS CDK infrastructure** — TypeScript CDK app provisioning the prod stack
  (VPC, ECS Fargate service for the API, RDS for Postgres with parameter group
  + automated backups, Secrets Manager for the HMAC secret, ALB with health
  checks against `/health` and `/ready`, IAM roles, CloudWatch dashboards).
  Demonstrates infra-as-code skill end to end. Tracked as the next pickup.
- **GitHub Actions CI** — workflow that runs `docker compose up -d postgres`,
  `npm ci`, `npm run build`, `npm test` on every push, plus the game runner
  as a separate job. Surfaces the green checks directly on the PR.
- **Partition retention** — a monthly job that `DETACH PARTITION CONCURRENTLY`s
  partitions older than the regulatory retention window and ships them to
  S3 cold storage.
- **OpenTelemetry tracing + Prometheus metrics** — span the TX boundaries,
  expose latency histograms per route, and surface a
  `partition_coverage_months_ahead` gauge to alert on maintenance failure.
- **Read replica routing for `/report/*`** — a feature-flagged second
  connection string so reports don't compete with the write path.
- **HMAC multi-secret rotation** — accept any of a comma-separated list of
  secrets so credentials rotate without downtime; wire format unchanged.
- **Property-based testing** with `fast-check` — generate random valid
  action sequences and compare the service's final state against a pure
  in-memory reference simulator.
- **Sub-day report precision** — already designed for: the rollup carries
  day-granular totals, and the boundary days can be supplemented by a
  partition-pruned query against `actions` when `from`/`to` aren't
  midnight-aligned.

## Configuration

| Env var                          | Purpose                                | Default                                  |
|----------------------------------|----------------------------------------|------------------------------------------|
| `DATABASE_URL`                   | Postgres connection string             | (required)                               |
| `BET_PROCESSOR_HMAC_SECRET`      | HMAC-SHA256 shared secret              | `test`                                   |
| `PORT`                           | HTTP listen port                       | `3000`                                   |
| `PARTITIONS_MONTHS_AHEAD`        | How many future months to ensure       | `3`                                      |
| `API_BASE_URL`                   | Used by the game runner                | `http://localhost:3000`                  |
