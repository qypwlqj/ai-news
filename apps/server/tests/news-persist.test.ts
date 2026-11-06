import { describe, expect, it } from 'vitest';
import {
  persistNewsBatch,
  persistNewsItem,
  updateNewsSummary,
  type SqlResult,
  type SqlRunner,
} from '../src/app/news-persist';
import { createCollectRun, finishCollectRun, saveSourceRun } from '../src/app/news-runs';

interface Call {
  sql: string;
  params?: readonly unknown[];
}

function createRunner(handler: (sql: string, params?: readonly unknown[]) => SqlResult<unknown>) {
  const calls: Call[] = [];
  const runner: SqlRunner = {
    async query<T>(sql: string, params?: readonly unknown[]): Promise<SqlResult<T>> {
      calls.push({ sql, params });
      return handler(sql, params) as SqlResult<T>;
    },
  };
  return { runner, calls };
}

const baseItem = {
  id: 'n1',
  title: 'OpenAI releases new model',
  url: 'https://example.com/a?utm_source=x',
  source: 'hacker_news',
  publishedAt: new Date('2025-06-01T00:00:00.000Z'),
  category: 'model_release',
};

describe('news-persist', () => {
  it('插入成功返回 inserted，并按规范化 URL 落库', async () => {
    const { runner, calls } = createRunner((sql) =>
      sql.startsWith('SELECT') ? { rows: [], rowCount: 0 } : { rows: [{ id: 'n1' }], rowCount: 1 },
    );
    await expect(persistNewsItem(runner, baseItem)).resolves.toEqual({ id: 'n1', status: 'inserted' });
    const insert = calls[1];
    expect(insert.sql).toContain('ON CONFLICT (normalized_url) DO NOTHING');
    expect(insert.params?.[4]).toBe('https://example.com/a');
    expect(insert.params?.[9]).toBe('model_release');
  });

  it('URL 冲突（无返回行）计为重复且不新增条目', async () => {
    const { runner } = createRunner((sql) =>
      sql.startsWith('SELECT') ? { rows: [], rowCount: 0 } : { rows: [], rowCount: 0 },
    );
    await expect(persistNewsItem(runner, baseItem)).resolves.toEqual({
      id: 'n1',
      status: 'duplicate',
      reason: 'normalized_url',
    });
  });

  it('近 7 天标题相似度 > 0.9 判为重复且不再写入', async () => {
    const { runner, calls } = createRunner(() => ({
      rows: [{ id: 'old', title: 'OpenAI releases new model' }],
      rowCount: 1,
    }));
    await expect(persistNewsItem(runner, baseItem)).resolves.toEqual({
      id: 'n1',
      status: 'duplicate',
      reason: 'title_similarity',
    });
    expect(calls).toHaveLength(1);
  });

  it('(source, external_id) 唯一冲突降级为重复不中断批次', async () => {
    const { runner } = createRunner((sql) => {
      if (sql.startsWith('SELECT')) return { rows: [], rowCount: 0 };
      const error = new Error('duplicate key') as Error & { code: string };
      error.code = '23505';
      throw error;
    });
    await expect(persistNewsItem(runner, baseItem)).resolves.toEqual({
      id: 'n1',
      status: 'duplicate',
      reason: 'external_id',
    });
  });

  it('批量入库统计 inserted 与 duplicates', async () => {
    const { runner } = createRunner((sql) =>
      sql.startsWith('SELECT') ? { rows: [], rowCount: 0 } : { rows: [{ id: 'x' }], rowCount: 1 },
    );
    const result = await persistNewsBatch(runner, [
      baseItem,
      { ...baseItem, id: 'n2', url: 'https://example.com/b' },
    ]);
    expect(result.inserted).toBe(2);
    expect(result.duplicates).toBe(0);
    expect(result.outcomes.map((outcome) => outcome.id)).toEqual(['n1', 'n2']);
  });

  it('摘要回填：failed 时 summary 写 NULL，未命中返回 false', async () => {
    const { runner, calls } = createRunner(() => ({ rows: [], rowCount: 1 }));
    await expect(
      updateNewsSummary(runner, {
        id: 'n1',
        summary: '摘要',
        summaryStatus: 'failed',
        category: 'industry_news',
      }),
    ).resolves.toBe(true);
    expect(calls[0].params?.[0]).toBeNull();
    expect(calls[0].params?.[1]).toBe('failed');

    const missing = createRunner(() => ({ rows: [], rowCount: 0 }));
    await expect(
      updateNewsSummary(missing.runner, { id: 'nope', summary: '摘要', summaryStatus: 'ok' }),
    ).resolves.toBe(false);
  });
});

describe('news-runs', () => {
  it('占位批次 → 回填终态与汇总计数', async () => {
    const { runner, calls } = createRunner(() => ({ rows: [], rowCount: 1 }));
    await createCollectRun(runner, {
      runId: 'r1',
      trigger: 'cron',
      runDate: '2025-06-01',
      startedAt: new Date('2025-06-01T00:00:00.000Z'),
    });
    expect(calls[0].sql).toContain('INSERT INTO collect_runs');

    await finishCollectRun(runner, {
      runId: 'r1',
      status: 'partial_failure',
      finishedAt: new Date('2025-06-01T00:00:42.000Z'),
      durationMs: 42000,
      totals: { fetched: 90, inserted: 72, duplicates: 18, summaryOk: 70, summaryFailed: 2 },
    });
    const finish = calls[1];
    expect(finish.sql).toContain('finished_at');
    expect(finish.params?.[1]).toBe('partial_failure');
    expect(finish.params?.[3]).toBe(42000);
    expect(finish.params?.[8]).toBe(2);
  });

  it('逐源 upsert 更新 attempts，错误信息截断到 2000 字', async () => {
    const { runner, calls } = createRunner(() => ({ rows: [], rowCount: 1 }));
    await saveSourceRun(runner, {
      id: 's1',
      runId: 'r1',
      source: 'hacker_news',
      status: 'failed',
      fetched: 30,
      inserted: 24,
      duplicates: 6,
      failed: 1,
      durationMs: 14000,
      attempts: 3,
      errorCode: 'FETCH_TIMEOUT',
      errorMessage: 'x'.repeat(3000),
    });
    expect(calls[0].sql).toContain('ON CONFLICT (run_id, source) DO UPDATE');
    expect(calls[0].params?.[9]).toBe(3);
    expect(String(calls[0].params?.[11]).length).toBeLessThanOrEqual(2000);
  });
});
