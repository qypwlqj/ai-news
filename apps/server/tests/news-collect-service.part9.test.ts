import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  COLLECT_ERROR_MESSAGE_MAX_CHARS,
  COLLECT_MAX_ATTEMPTS,
  runCollect,
  type CollectPorts,
  type CollectSource,
  type CollectTrigger,
  type SourceCounts,
  type SourceRunRecord,
} from '../src/app/news-collect-service';

interface Raw {
  url: string;
}

interface HarnessOptions {
  lockAvailable?: boolean;
  previousRunId?: string | null;
  fetch?: (source: CollectSource) => Promise<readonly Raw[]>;
  ingest?: (source: CollectSource, items: readonly Raw[]) => Promise<SourceCounts>;
}

function createHarness(options: HarnessOptions = {}) {
  const events: string[] = [];
  const calls = {
    fetch: [] as CollectSource[],
    created: [] as string[],
    saved: [] as SourceRunRecord[],
    finished: [] as { status: string }[],
    unlocked: 0,
  };
  let tick = Date.parse('2025-06-01T00:00:00.000Z');

  const ports: CollectPorts<Raw> = {
    async tryLock() {
      events.push('lock');
      return options.lockAvailable ?? true;
    },
    async unlock() {
      calls.unlocked += 1;
      events.push('unlock');
    },
    async findSuccessfulRun() {
      return options.previousRunId ?? null;
    },
    async createRun(input) {
      calls.created.push(input.runId);
    },
    async finishRun(input) {
      calls.finished.push({ status: input.status });
    },
    async saveSourceRun(input) {
      calls.saved.push(input.record);
    },
    async fetchSource(source) {
      calls.fetch.push(source);
      if (options.fetch) return options.fetch(source);
      return [{ url: `https://example.com/${source}` }];
    },
    async ingestSource(source, items) {
      if (options.ingest) return options.ingest(source, items);
      return {
        fetched: items.length,
        inserted: items.length,
        duplicates: 0,
        summaryOk: items.length,
        summaryFailed: 0,
      };
    },
    now() {
      tick += 1000;
      return new Date(tick);
    },
    createId() {
      return `run-${calls.created.length + 1}`;
    },
  };

  return { ports, calls, events };
}

function request(trigger: CollectTrigger = 'api', over: Partial<{ force: boolean; sources: CollectSource[] }> = {}) {
  return { trigger, date: '2025-06-01', ...over };
}

test('锁冲突返回 409 COLLECT_IN_PROGRESS 且不写批次', async () => {
  const harness = createHarness({ lockAvailable: false });
  const result = await runCollect(request(), harness.ports);

  assert.equal(result.httpStatus, 409);
  assert.equal(result.error?.code, 'COLLECT_IN_PROGRESS');
  assert.equal(result.body, undefined);
  assert.deepEqual(harness.calls.created, []);
  assert.deepEqual(harness.calls.fetch, []);
  assert.equal(harness.calls.unlocked, 0);
  assert.deepEqual(harness.events, ['lock']);
});

test('当日已有成功批次且未 force 时全部来源 skipped', async () => {
  const harness = createHarness({ previousRunId: 'run-prev' });
  const result = await runCollect(request('cron'), harness.ports);

  assert.equal(result.httpStatus, 200);
  assert.equal(result.body?.runId, 'run-prev');
  assert.equal(result.body?.status, 'success');
  assert.deepEqual(
    result.body?.sources.map((record) => [record.source, record.status, record.attempts]),
    [
      ['hacker_news', 'skipped', 0],
      ['arxiv_cs_ai', 'skipped', 0],
      ['jiqizhixin', 'skipped', 0],
    ],
  );
  assert.deepEqual(harness.calls.created, []);
  assert.deepEqual(harness.calls.fetch, []);
  assert.equal(harness.calls.unlocked, 1);
  assert.deepEqual(result.body?.totals, {
    fetched: 0,
    inserted: 0,
    duplicates: 0,
    summaryOk: 0,
    summaryFailed: 0,
    failed: 0,
  });
});

test('force=true 忽略幂等短路重跑三来源', async () => {
  const harness = createHarness({ previousRunId: 'run-prev' });
  const result = await runCollect(request('api', { force: true }), harness.ports);

  assert.equal(result.httpStatus, 200);
  assert.equal(result.body?.status, 'success');
  assert.equal(result.body?.runId, 'run-1');
  assert.deepEqual(harness.calls.fetch, ['hacker_news', 'arxiv_cs_ai', 'jiqizhixin']);
  assert.equal(harness.calls.saved.length, 3);
});

test('单源失败自动重试，第三次成功时 attempts=3 且整体 success', async () => {
  let arxivAttempts = 0;
  const harness = createHarness({
    fetch: async (source) => {
      if (source === 'arxiv_cs_ai') {
        arxivAttempts += 1;
        if (arxivAttempts < COLLECT_MAX_ATTEMPTS) {
          throw Object.assign(new Error('upstream 503'), { code: 'FETCH_HTTP_ERROR' });
        }
      }
      return [{ url: `https://example.com/${source}` }];
    },
  });

  const result = await runCollect(request('cron'), harness.ports);
  const arxiv = result.body?.sources.find((record) => record.source === 'arxiv_cs_ai');

  assert.equal(result.httpStatus, 200);
  assert.equal(result.body?.status, 'success');
  assert.equal(arxiv?.status, 'success');
  assert.equal(arxiv?.attempts, 3);
  assert.equal(arxivAttempts, 3);
});

test('某源持续失败最多重试 3 次，其它源成功时 200 partial_failure', async () => {
  let failures = 0;
  const harness = createHarness({
    fetch: async (source) => {
      if (source === 'jiqizhixin') {
        failures += 1;
        throw Object.assign(new Error('rss 404'), { code: 'FETCH_HTTP_ERROR' });
      }
      return [{ url: `https://example.com/${source}` }];
    },
  });

  const result = await runCollect(request(), harness.ports);
  const jqz = result.body?.sources.find((record) => record.source === 'jiqizhixin');

  assert.equal(result.httpStatus, 200);
  assert.equal(result.body?.status, 'partial_failure');
  assert.equal(failures, COLLECT_MAX_ATTEMPTS);
  assert.equal(jqz?.status, 'failed');
  assert.equal(jqz?.attempts, COLLECT_MAX_ATTEMPTS);
  assert.equal(jqz?.error?.code, 'FETCH_HTTP_ERROR');
  assert.equal(result.body?.sources.filter((record) => record.status === 'success').length, 2);
  assert.deepEqual(harness.calls.finished.map((item) => item.status), ['partial_failure']);
});

test('全部来源失败返回 502 ALL_SOURCES_FAILED 且响应体结构不变', async () => {
  const harness = createHarness({
    fetch: async () => {
      throw new Error('boom');
    },
  });

  const result = await runCollect(request('cron'), harness.ports);

  assert.equal(result.httpStatus, 502);
  assert.equal(result.error?.code, 'ALL_SOURCES_FAILED');
  assert.equal(result.body?.status, 'failed');
  assert.equal(result.body?.sources.length, 3);
  assert.equal(result.body?.totals.failed, 3);
  assert.equal(result.body?.sources[0]?.error?.code, 'SOURCE_FETCH_FAILED');
  assert.deepEqual(harness.calls.finished.map((item) => item.status), ['failed']);
  assert.equal(harness.calls.unlocked, 1);
});

test('批次 totals 为逐源计数求和', async () => {
  const harness = createHarness({
    ingest: async (_source, items) => ({
      fetched: items.length + 5,
      inserted: 2,
      duplicates: 3,
      summaryOk: 1,
      summaryFailed: 1,
    }),
  });

  const result = await runCollect(request(), harness.ports);

  assert.deepEqual(result.body?.totals, {
    fetched: 18,
    inserted: 6,
    duplicates: 9,
    summaryOk: 3,
    summaryFailed: 3,
    failed: 0,
  });
});

test('失败原因 message 截断至 2000 字以内并压平空白', async () => {
  const longMessage = `  ${'x'.repeat(COLLECT_ERROR_MESSAGE_MAX_CHARS + 50)}  `;
  const harness = createHarness({
    fetch: async () => {
      throw new Error(longMessage);
    },
  });

  const result = await runCollect(request('api', { sources: ['hacker_news'] }), harness.ports);
  const message = result.body?.sources[0]?.error?.message ?? '';

  assert.equal(result.httpStatus, 502);
  assert.equal(message.length, COLLECT_ERROR_MESSAGE_MAX_CHARS + 1);
  assert.ok(message.startsWith('xxxxx'));
  assert.ok(message.endsWith('…'));
});
