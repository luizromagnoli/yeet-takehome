import { describe, expect, it } from 'vitest';
import { resolveDatabaseUrl } from './pool.provider';

describe('resolveDatabaseUrl', () => {
  it('returns DATABASE_URL when set, ignoring DB_*', () => {
    const url = resolveDatabaseUrl({
      DATABASE_URL: 'postgres://override@db/yeet',
      DB_HOST: 'should-be-ignored',
      DB_USER: 'ignored',
      DB_PASSWORD: 'ignored',
    });
    expect(url).toBe('postgres://override@db/yeet');
  });

  it('composes from DB_HOST/DB_USER/DB_PASSWORD with defaults for port and name', () => {
    const url = resolveDatabaseUrl({
      DB_HOST: 'db.internal',
      DB_USER: 'yeet_admin',
      DB_PASSWORD: 'secret',
    });
    expect(url).toBe('postgres://yeet_admin:secret@db.internal:5432/yeet');
  });

  it('honors DB_PORT and DB_NAME when provided', () => {
    const url = resolveDatabaseUrl({
      DB_HOST: 'db.internal',
      DB_PORT: '5433',
      DB_USER: 'yeet_admin',
      DB_PASSWORD: 'secret',
      DB_NAME: 'yeet_prod',
    });
    expect(url).toBe('postgres://yeet_admin:secret@db.internal:5433/yeet_prod');
  });

  it('URL-encodes credentials so reserved characters survive', () => {
    const url = resolveDatabaseUrl({
      DB_HOST: 'db.internal',
      DB_USER: 'admin@scope',
      DB_PASSWORD: 'p@ss/word:!',
    });
    expect(url).toBe(
      'postgres://admin%40scope:p%40ss%2Fword%3A!@db.internal:5432/yeet',
    );
  });

  it('throws when neither DATABASE_URL nor the DB_* triple is set', () => {
    expect(() => resolveDatabaseUrl({})).toThrow(
      /database connection not configured/,
    );
    expect(() => resolveDatabaseUrl({ DB_HOST: 'db' })).toThrow(
      /database connection not configured/,
    );
    expect(() =>
      resolveDatabaseUrl({ DB_HOST: 'db', DB_USER: 'u' }),
    ).toThrow(/database connection not configured/);
  });
});
