import { describe, expect, it } from 'vitest';
import {
  SCHEMA_ENUMS,
  SCHEMA_STATEMENTS,
  SCHEMA_VERSION,
  applySchema,
  createEnumStatements,
  schemaSql,
} from '../src/app/news-schema';

const DDL = schemaSql();
const createStatements = SCHEMA_STATEMENTS.filter((sql) => /^CREATE (UNIQUE )?(TABLE|INDEX)/.test(sql));
const indexNames = Array.from(DDL.matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS (\w+)/g)).map(
  (match) => match[1],
);

describe('news-schema 幂等 DDL', () => {
  it('表与索引创建全部带 IF NOT EXISTS', () => {
    expect(createStatements).toHaveLength(15);
    for (const sql of createStatements) expect(sql).toContain('IF NOT EXISTS');
  });

  it('枚举用 duplicate_object 守护并按值 IF NOT EXISTS 追加', () => {
    for (const [name, values] of Object.entries(SCHEMA_ENUMS)) {
      const statements = createEnumStatements(name, values);
      expect(statements[0]).toContain(`CREATE TYPE "${name}" AS ENUM`);
      expect(statements[0]).toContain('EXCEPTION WHEN duplicate_object THEN NULL');
      const joined = statements.join('\n');
      for (const value of values) {
        expect(joined).toContain(`ALTER TYPE "${name}" ADD VALUE IF NOT EXISTS '${value}'`);
      }
    }
  });

  it('冻结枚举取值与接口契约一致', () => {
    expect(SCHEMA_ENUMS.source_enum).toEqual(['hacker_news', 'arxiv_cs_ai', 'jiqizhixin']);
    expect(SCHEMA_ENUMS.category_enum).toEqual([
      'model_release',
      'research_paper',
      'product_application',
      'industry_news',
      'policy_funding',
    ]);
    expect(SCHEMA_ENUMS.summary_status_enum).toEqual(['ok', 'failed', 'pending']);
    expect(SCHEMA_ENUMS.source_run_status_enum).toContain('skipped');
  });

  it('三张表的列与规格一致', () => {
    expect(DDL).toContain('CREATE TABLE IF NOT EXISTS news_items');
    expect(DDL).toContain('CREATE TABLE IF NOT EXISTS collect_runs');
    expect(DDL).toContain('CREATE TABLE IF NOT EXISTS collect_run_sources');
    expect(DDL).toContain('normalized_url text NOT NULL');
    expect(DDL).toContain('title_fingerprint text NOT NULL');
    expect(DDL).toContain("summary_status summary_status_enum NOT NULL DEFAULT 'pending'");
    expect(DDL).toContain('REFERENCES collect_runs (id) ON DELETE CASCADE');
  });

  it('索引覆盖去重、排序与分类查询路径', () => {
    expect(indexNames).toEqual(
      expect.arrayContaining([
        'news_items_normalized_url_uidx',
        'news_items_source_external_id_uidx',
        'news_items_published_at_idx',
        'news_items_category_published_at_idx',
        'news_items_title_fingerprint_published_at_idx',
        'news_items_summary_status_partial_idx',
        'collect_run_sources_run_id_source_uidx',
      ]),
    );
    expect(DDL).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS news_items_normalized_url_uidx ON news_items (normalized_url);',
    );
    expect(DDL).toContain(
      'news_items_title_fingerprint_published_at_idx ON news_items (title_fingerprint, published_at DESC);',
    );
    expect(DDL).toContain(
      'news_items_category_published_at_idx ON news_items (category, published_at DESC, id DESC);',
    );
    expect(DDL).toContain("WHERE summary_status <> 'ok'");
    expect(DDL).toContain(
      'collect_run_sources_run_id_source_uidx ON collect_run_sources (run_id, source);',
    );
  });

  it('不含破坏性语句（只增不改）', () => {
    expect(DDL).not.toMatch(/\bDROP\b/);
    expect(DDL).not.toMatch(/\bTRUNCATE\b/i);
  });

  it('applySchema 按顺序执行且可重复重放', async () => {
    const seen: string[] = [];
    const executor = {
      query: async (sql: string) => {
        seen.push(sql);
        return undefined;
      },
    };
    const first = await applySchema(executor);
    const second = await applySchema(executor);
    expect(first.version).toBe(SCHEMA_VERSION);
    expect(first.executed).toBe(SCHEMA_STATEMENTS.length);
    expect(second.executed).toBe(first.executed);
    expect(seen).toHaveLength(SCHEMA_STATEMENTS.length * 2);
    expect(seen.slice(0, SCHEMA_STATEMENTS.length)).toEqual([...SCHEMA_STATEMENTS]);
  });

  it('执行失败时中断并抛出，不吞错', async () => {
    let calls = 0;
    const executor = {
      query: async () => {
        calls += 1;
        if (calls === 3) throw new Error('boom');
        return undefined;
      },
    };
    await expect(applySchema(executor)).rejects.toThrow('boom');
    expect(calls).toBe(3);
  });

  it('createEnumStatements 拒绝空枚举取值', () => {
    expect(() => createEnumStatements('bad_enum', [])).toThrow();
  });
});
