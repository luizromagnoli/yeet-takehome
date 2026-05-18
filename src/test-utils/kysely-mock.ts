import { type Mock, vi } from 'vitest';

/**
 * Chainable mock of a Kysely query builder + transaction. Every builder
 * method (insertInto, selectFrom, values, where, onConflict, returning,
 * etc.) returns the same mock instance, so a chain like
 * `db.insertInto('foo').values({...}).returning('bar').executeTakeFirst()`
 * resolves through one set of `vi.fn()`s and exposes every step as a
 * spy for assertion.
 *
 * Terminal methods (`execute`, `executeTakeFirst`, `executeTakeFirstOrThrow`)
 * default to resolving `undefined` / `[]` so tests can selectively set
 * their return values via `mock.executeTakeFirst.mockResolvedValueOnce(...)`.
 */
export interface KyselyMock {
  // builder steps
  insertInto: Mock;
  selectFrom: Mock;
  updateTable: Mock;
  deleteFrom: Mock;
  values: Mock;
  set: Mock;
  where: Mock;
  select: Mock;
  selectAll: Mock;
  onConflict: Mock;
  returning: Mock;
  returningAll: Mock;
  forUpdate: Mock;
  columns: Mock;
  column: Mock;
  doNothing: Mock;
  doUpdateSet: Mock;
  ref: Mock;
  transaction: Mock;

  // terminal steps
  execute: Mock;
  executeTakeFirst: Mock;
  executeTakeFirstOrThrow: Mock;
  // Used by raw `sql\`…\`.execute(db)` templates, which compile and call
  // db.executeQuery() rather than going through the chainable builder.
  executeQuery: Mock;

  // helpers
  $reset: () => void;
}

/**
 * The list of builder methods that should chain. Any method called on the
 * mock that isn't a terminal returns the mock itself. New Kysely surface
 * area can be added here without touching every test.
 */
const CHAIN_METHODS = [
  'insertInto',
  'selectFrom',
  'updateTable',
  'deleteFrom',
  'values',
  'set',
  'where',
  'select',
  'selectAll',
  'returning',
  'returningAll',
  'forUpdate',
  'columns',
  'column',
  'ref',
] as const;

const TERMINAL_METHODS = [
  'execute',
  'executeTakeFirst',
  'executeTakeFirstOrThrow',
  'executeQuery',
] as const;

export function makeKyselyMock(): KyselyMock {
  const mock = {} as KyselyMock;

  for (const name of CHAIN_METHODS) {
    (mock as unknown as Record<string, Mock>)[name] = vi.fn(() => mock);
  }

  // onConflict takes a builder callback `(oc) => oc.columns(...).doNothing()`.
  // Invoke it with a mini-builder so the test's assertion of doNothing/columns
  // sees the call.
  mock.onConflict = vi.fn((cb: (oc: KyselyMock) => unknown) => {
    cb(mock);
    return mock;
  });
  mock.doNothing = vi.fn(() => mock);
  mock.doUpdateSet = vi.fn(() => mock);

  // `transaction()` returns an executor with an `.execute(callback)` method
  // that calls the callback with the mock itself as the transaction handle.
  mock.transaction = vi.fn(() => ({
    execute: vi.fn(<T>(cb: (trx: KyselyMock) => Promise<T>) => cb(mock)),
  }));

  // Terminal methods default to resolving safely so tests only need to
  // override the ones they care about.
  mock.execute = vi.fn().mockResolvedValue({ rows: [] });
  mock.executeTakeFirst = vi.fn().mockResolvedValue(undefined);
  mock.executeTakeFirstOrThrow = vi
    .fn()
    .mockResolvedValue({} as Record<string, unknown>);
  mock.executeQuery = vi.fn().mockResolvedValue({ rows: [] });

  mock.$reset = () => {
    for (const name of [...CHAIN_METHODS, ...TERMINAL_METHODS] as const) {
      (mock as unknown as Record<string, Mock>)[name].mockClear();
    }
    mock.onConflict.mockClear();
    mock.doNothing.mockClear();
    mock.doUpdateSet.mockClear();
    mock.transaction.mockClear();
  };

  return mock;
}
