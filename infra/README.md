# Yeet — AWS CDK MVP infra

Synth-only CDK app that materialises the production-shape stack the main README
roadmaps. **Never deployed.** The goal is to demonstrate the IaC end-to-end —
the reviewer can read the code and inspect the synthesised CloudFormation
without ever touching an AWS account.

## Stack layout

Four granular stacks, separated by lifecycle and blast radius. Each app deploy
only re-publishes `Yeet-Service`; data and secrets never move.

| Stack | Owns | Lifecycle | Deps |
|---|---|---|---|
| `Yeet-Network` | VPC, subnets, interface + gateway VPC endpoints | Foundational; rarely changes | None |
| `Yeet-Secrets` | HMAC Secrets Manager secret | Independent of compute and data | None |
| `Yeet-Data`    | RDS PostgreSQL 16 (`db.t4g.micro`), DB security group, RDS-managed credential secret | Persistent; tear-down loses data | `Yeet-Network` |
| `Yeet-Service` | ECS Fargate cluster + task/service, ALB + listener + target group, CloudWatch log group, IAM roles | Volatile; every app deploy lands here | `Yeet-Network`, `Yeet-Data`, `Yeet-Secrets` |

Cross-stack references are CFN exports/imports — `Yeet-Service`'s template
carries 14 `Fn::ImportValue` calls reaching into the other three stacks.

## Run

```sh
cd infra
npm install

# Synthesise all four stacks without invoking Docker. Reviewer-friendly.
# Falls back to ContainerImage.fromRegistry('public.ecr.aws/.../node:24-alpine')
# so the synth doesn't require Docker Desktop.
npx cdk synth -c useLocalAsset=false --quiet

# Synthesise with the real Dockerfile asset (requires Docker running).
# This is the path a real deploy would take — CDK builds + pushes the image
# from the repo's Dockerfile.
npx cdk synth --quiet

# List the four stacks
npx cdk ls -c useLocalAsset=false
# → Yeet-Network
# → Yeet-Secrets
# → Yeet-Data
# → Yeet-Service

# Typecheck the CDK code itself (tsx skips this at synth)
npx tsc --noEmit
```

## What the app needs from this stack

| Env var | Source | Notes |
|---|---|---|
| `DATABASE_URL` | unset by default; the app composes it | See `src/db/pool.provider.ts` |
| `DB_HOST` | RDS endpoint address (plain env) | `Yeet-Data` exports it |
| `DB_PORT` | RDS endpoint port (plain env) | `Yeet-Data` exports it |
| `DB_NAME` | `yeet` (plain env) | hard-coded in `ServiceStack` |
| `DB_USER` | `username` field of the RDS-managed secret | injected via `ecs.Secret.fromSecretsManager` |
| `DB_PASSWORD` | `password` field of the RDS-managed secret | injected via `ecs.Secret.fromSecretsManager` |
| `BET_PROCESSOR_HMAC_SECRET` | whole-string `Yeet-Secrets` secret | injected via `ecs.Secret.fromSecretsManager` |
| `PORT` | `'3000'` | hard-coded |
| `MIGRATE_ON_BOOT` | `'true'` | runs migrations at first container boot |
| `PARTITIONS_MONTHS_AHEAD` | `'3'` | matches main.ts default |
| `ACTION_IDEMPOTENCY_RETENTION_DAYS` | `'90'` | matches `IdempotencyCleanupService` default |

## Cost note (us-east-1, hypothetical)

If deployed today, the stack would run roughly **$70–80/month**:

| Resource | Approx $/mo |
|---|---|
| 4× interface VPC endpoints (ECR API/DKR, Logs, Secrets Manager) | ~$29 |
| ALB (1 LCU baseline) | ~$19 |
| RDS `db.t4g.micro`, 20 GB gp3, 1d backup | ~$16 |
| Fargate task (0.25 vCPU / 0.5 GB, 24×7, ARM) | ~$7 |
| Secrets Manager (2 secrets) | ~$1 |
| CloudWatch Logs (~1 GB ingest + retention) | ~$1 |
| S3 gateway endpoint, data transfer | ~$0 |

The four interface endpoints are the single biggest line item. Drop them and
reintroduce a NAT gateway (~$32/mo) if you ever need outbound internet from
the workload.

## Explicit scope cuts

These are *deliberately* not in the stack. Each is a clean next-PR pickup, not
an oversight:

- TLS (no ACM cert / no 443 listener) — ALB serves HTTP only
- Route 53 / DNS
- Multi-AZ RDS + read replica
- Autoscaling / `desiredCount > 1`
- WAF
- CloudWatch dashboards / alarms (only log group + retention)
- Performance Insights / Enhanced Monitoring
- CDK Pipelines / CodeBuild deploy automation
- `cdk-nag` (would surface the missing-TLS finding immediately; useful follow-on)

## Reality check on `desiredCount: 1` + `MIGRATE_ON_BOOT`

With one task, only one container ever runs the Kysely migrator at boot — no
contention. The pattern doesn't generalise: the moment you scale to N tasks,
two containers can race the migrator. The app's cron services already use
`pg_try_advisory_lock(hashtext(...))` for single-leader semantics — the same
pattern wraps the migration runner if/when this stack ever exits MVP profile
(or, more conventional, split migrations out into a one-shot ECS `RunTask`
gated behind a CodePipeline step).

## A note on cross-stack security group rules

The DB security group in `Yeet-Data` and the endpoints security group in
`Yeet-Network` both accept ingress from the VPC CIDR, not from a peer
security group ID. This is deliberate: peering across stacks would emit a
cross-stack import that points the *other* direction — e.g., the DB SG would
import the Service SG ID, which creates a `Yeet-Data` → `Yeet-Service` edge
on top of the existing `Yeet-Service` → `Yeet-Data` edge, and CDK rejects
the resulting cycle. VPC-CIDR ingress is functionally equivalent here
because only the API task and RDS run in the isolated subnets. For a
tighter posture, fold network + service into one stack, or replace the
VPC-CIDR rule with an explicit `serviceSg.peerSecurityGroupId` reference
resolved via a `CfnParameter` written by a deploy-time wrapper.
