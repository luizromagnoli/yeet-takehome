process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://yeet:yeet@localhost:5432/yeet';
process.env.BET_PROCESSOR_HMAC_SECRET =
  process.env.BET_PROCESSOR_HMAC_SECRET ?? 'test';

// Silence Nest's startup logs during tests; failures still surface via thrown
// exceptions and supertest assertions.
process.env.NEST_DISABLE_LOGS = '1';
