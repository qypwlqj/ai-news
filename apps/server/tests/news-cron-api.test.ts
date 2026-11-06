import { describe, expect, it } from 'vitest';
import {
  handleCronCollect,
  handleGetCollectRun,
  handleListCollectRuns,
  parseCollectBody,
  parseRunsQuery,
  serializeRun,
  verifyBearer,
} from '../src/app/news-api-ops';

const SECRET = 'test-secret-value';

const baseRun = {
  runId: 'run_1',
  trigger: 'api',
  date: '2025-06-01',
  status: 'success',
  startedAt: '2025-06-01T00:00:00.000Z',
  finishedAt: '2025-06-01T00:00:42.000Z',
  durationMs: 42000,
  totals: { fetched: 90, inserted: 72, duplicates: 18, summaryOk: 70, summaryFailed: 2 },
  sources: [
    {
      source: 'hacker_news',
      status: 'success',
      fetched: 30,
      inserted: 24,
      duplicates: 6,
      failed: 0,
      durationMs: 14000,
      attempts: 1,
    },
  ],
};

describe('verifyBearer', () => {
  it('区分 401 与 403', () => {
    expect(verifyBearer(null, SECRET)).toBe('unauthorized');
    expect(verifyBearer('Basic abc', SECRET)).toBe('unauthorized');
    expect(verifyBearer('Bearer wrong', SECRET)).toBe('forbidden');
    expect(verifyBearer(`Bearer ${SECRET}`, null)).toBe('forbidden');
    expect(verifyBearer(`Bearer ${SECRET}`, SECRET)).toBe('ok');
  });
});

describe('parseCollectBody', () => {
  it('空 body 取默认值，非法枚举 400', () => {
    const ok = parseCollectBody(undefined, '2025-06-01');
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value.date).toBe('2025-06-01');
      expect(ok.value.sources).toEqual(['hacker_news', 'arxiv_cs_ai', 'jiqizhixin']);
      expect(ok.value.force).toBe(false);
    }
    const badDate = parseCollectBody({ date: '2025/06/01' }, '2025-06-01');
    expect(badDate.ok ? null : badDate.code).toBe('INVALID_DATE');
    const badSource = parseCollectBody({ sources: ['hacker_news', 'zhihu'] }, '2025-06-01');
    expect(badSource.ok ? null : badSource.code).toBe('INVALID_SOURCE');
  });
});

describe('handleCronCollect', () => {
  it('鉴权失败返回 401/403 且不调用编排', async () => {
    let called = 0;
    const deps = { secret: SECRET, runCollect: () => { called += 1; return baseRun; } };
    const unauth = await handleCronCollect({ authorization: null }, deps);
    expect(unauth.status).toBe(401);
    const forbidden = await handleCronCollect({ authorization: 'Bearer nope' }, deps);
    expect(forbidden.status).toBe(403);
    expect(called).toBe(0);
  });

  it('成功返回契约字段且不泄漏凭据', async () => {
    const deps = {
      secret: SECRET,
      today: () => '2025-06-01',
      requestId: () => 'req_fixed',
      runCollect: async () => ({ ...baseRun, httpStatus: 200, apiKey: 'sk-leak' }),
    };
    const response = await handleCronCollect({ authorization: `Bearer ${SECRET}` }, deps);
    expect(response.status).toBe(200);
    const body = response.body as Record<string, unknown>;
    expect(body.runId).toBe('run_1');
    expect(body.date).toBe('2025-06-01');
    expect((body.totals as Record<string, number>).inserted).toBe(72);
    expect((body.sources as Array<Record<string, unknown>>)[0].attempts).toBe(1);
    expect(JSON.stringify(body)).not.toContain('sk-leak');
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(body.httpStatus).toBeUndefined();
  });

  it('全源失败透传 502，校验失败返回 400', async () => {
    const failed = await handleCronCollect(
      { authorization: `Bearer ${SECRET}`, body: { sources: ['arxiv_cs_ai'] } },
      { secret: SECRET, runCollect: () => ({ ...baseRun, status: 'failed', httpStatus: 502 }) },
    );
    expect(failed.status).toBe(502);
    const invalid = await handleCronCollect(
      { authorization: `Bearer ${SECRET}`, body: { date: 'bad' } },
      { secret: SECRET, runCollect: () => baseRun },
    );
    expect(invalid.status).toBe(400);
    expect((invalid.body as { error: { code: string } }).error.code).toBe('INVALID_DATE');
  });
});

describe('collect-runs 查询与详情', () => {
  it('默认分页并只返回行摘要', async () => {
    const response = await handleListCollectRuns(
      {},
      { listRuns: async () => ({ items: [baseRun], total: 21 }) },
    );
    expect(response.status).toBe(200);
    const body = response.body as Record<string, unknown>;
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
    expect(body.totalPages).toBe(2);
    expect((body.items as Array<Record<string, unknown>>)[0].sources).toBeUndefined();
  });

  it('非法 status / 分页返回 400', () => {
    expect(parseRunsQuery({ status: 'running' }).ok).toBe(false);
    expect(parseRunsQuery({ limit: '200' }).ok).toBe(false);
    expect(parseRunsQuery({ page: '0' }).ok).toBe(false);
  });

  it('详情未结束批次 finishedAt 为 null，缺失返回 404', async () => {
    const pending = await handleGetCollectRun(
      { runId: 'run_2' },
      { getRun: async () => ({ ...baseRun, runId: 'run_2', finishedAt: null, sources: [] }) },
    );
    expect(pending.status).toBe(200);
    expect((pending.body as Record<string, unknown>).finishedAt).toBeNull();
    const missing = await handleGetCollectRun({ runId: 'nope' }, { getRun: async () => null });
    expect(missing.status).toBe(404);
    expect(serializeRun({ ...baseRun, sources: [] }).sources).toEqual([]);
  });
});
