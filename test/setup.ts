// Default to the dedicated yeet_test database so the test suite never
// touches the dev/app data. Override via DATABASE_URL if you really need to
// point it elsewhere.
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://yeet:yeet@localhost:5432/yeet_test';
process.env.BET_PROCESSOR_HMAC_SECRET =
  process.env.BET_PROCESSOR_HMAC_SECRET ?? 'test';

// Silence Nest's startup logs during tests; failures still surface via thrown
// exceptions and supertest assertions.
process.env.NEST_DISABLE_LOGS = '1';

// Disable Nest's Logger globally for the test run. Unit tests instantiate
// controllers and services directly (no NestFactory.create), so the env var
// alone is not enough — we have to call overrideLogger to mute the per-class
// `new Logger(name)` instances.
import { Logger } from '@nestjs/common';
Logger.overrideLogger(false);
