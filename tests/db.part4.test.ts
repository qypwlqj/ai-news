import { describe, expect, it, vi } from 'vitest';
import { DDL_STATEMENTS, SCHEMA_VERSION } from '../src/lib/db/ddl';
import {
  applySchema,
  createPostgresDatabase,
  DatabaseUnavailableError,
  loadPgDriver,
  type Database,
} from '../src/lib/db/postgres';

describe('ddl', () => {
  it('defines the 5-value category enum and dedup unique keys', () => {
    const sql = DDL_STATEMENTS.join(';\n');
    expect(SCHEMA_VERSION).toBe(1);
    expect(sql).toContain(
      "CREATE TYPE category_enum AS ENUM ('model_release', 'research_paper', 'product_application', 'industry_news', 'policy_funding')",
    );
    expect(sql).toContain('CREATE UNIQUE INDEX news_items_normalized_url_uidx ON news_items (normalized_url)');
    expect(sql).toContain('CREATE UNIQUE INDEX news_items_source_external_id_uidx ON news_items (source, external_id)');
  });

  it('keeps query indexes and never drops data', () => {
    const sql = DDL_STATEMENTS.join(';\n');
    expect(sql).toContain('CREATE INDEX news_items_category_published_at_idx');
    expect(sql).toContain('CREATE INDEX news_items_published_at_idx');
    expect(sql).toContain("WHERE summary_status <> 'ok'");
    expect(sql).toContain('CREATE UNIQUE INDEX collect_run_sources_run_id_source_uidx');
    expect(sql).not.toMatch(/DROP TABLE|TRUNCATE/i);
    expect(DDL_STATEMENTS.every((statement) => statement.trim().length > 0 && !statement.trim().endsWith(';'))).toBe(
      true,
    );
  });
});

describe('applySchema', () => {
  it('executes every statement in order and propagates failures', async () => {
    const calls: string[] = [];
    const db: Database = {
      query: async (sql) => {
        calls.push(sql);
        return { rows: [], rowCount: 0 };
      },
      close: async () => undefined,
    };

    await expect(applySchema(db)).resolves.toBe(DDL_STATEMENTS.length);
    expect(calls).toEqual([...DDL_STATEMENTS]);
    await expect(applySchema({ query: async () => Promise.reject(new Error('boom')) }, ['SELECT 1'])).rejects.toThrow(
      'boom',
    );
  });
});

describe('postgres adapter', () => {
  it('degrades with a readable error when pg is missing', async () => {
    await expect(
      loadPgDriver(async () => {
        throw new Error('Cannot find module pg');
      }),
    ).rejects.toBeInstanceOf(DatabaseUnavailableError);
    await expect(
      loadPgDriver(async () => {
        throw new Error('Cannot find module pg');
      }),
    ).rejects.toThrow(/pg driver is unavailable/);
    await expect(loadPgDriver(async () => ({}))).rejects.toThrow(/does not export Pool/);
  });

  it('wraps a Pool as query/close and supports default export modules', async () => {
    const pool = {
      query: vi.fn(async () => ({ rows: [{ ok: true }], rowCount: 1 })),
      end: vi.fn(async () => undefined),
    };
    const importer = async () => ({
      default: {
        Pool: class {
          constructor(readonly config: unknown) {}
          query = pool.query;
          end = pool.end;
        },
      },
    });

    const db = await createPostgresDatabase({ connectionString: 'postgres://local/test' }, importer);
    await expect(db.query('SELECT 1')).resolves.toEqual({ rows: [{ ok: true }], rowCount: 1 });
    await db.close();
    expect(pool.end).toHaveBeenCalledTimes(1);
  });
});
