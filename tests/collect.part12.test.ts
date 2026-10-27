import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_ATTEMPTS, runCollect } from '../src/lib/collect';
import type { RawItem } from '../src/lib/collect';
import type { NewsRepository } from '../src/lib/db/repository';
import type { Category, NewsItemRecord, Source } from '../src/lib/types';

interface SummaryCall {
  id: string;
  summary: string | null;
  summaryStatus: string;
  category: Category;
}

interface SourceRunCall {
  source: Source;
  status: string;
  attempts: number;
}

interface Stub {
  repo: NewsRepository;
  inserted: NewsItemRecord[];
  summaries: SummaryCall[];
  sourceRuns: SourceRunCall[];
}

function createStub(): Stub {
  const inserted: NewsItemRecord[] = [];
  const summaries: SummaryCall[] = [];
  const sourceRuns: SourceRunCall[] = [];
  const repo = {
    async findSuccessfulRun() {
      return null;
    },
    async createRun() {
      return undefined;
    },
    async finishRun() {
      return undefined;
    },
    async saveSourceRun(row: SourceRunCall) {
      sourceRuns.push({ source: row.source, status: row.status, attempts: row.attempts });
    },
    async insertNews(record: NewsItemRecord) {
      inserted.push(record);
      return { inserted: true };
    },
    async saveSummary(id: string, input: Omit<SummaryCall, 'id'>) {
      summaries.push({ id, ...input });
    },
  } as unknown as NewsRepository;
  return { repo, inserted, summaries, sourceRuns };
}

const NOW = () => new Date('2025-06-01T02:00:00.000Z');

function rawItem(source: Source, index: number): RawItem {
  return {
    title: `${source} 资讯 ${index}`,
    url: `https://example.com/${source}/${index}`,
    source,
    publishedAt: new Date('2025-06-01T01:00:00.000Z'),
  };
}

test('LLM 失败降级：条目仍入库、summary_status=failed、批次不中断', async () => {
  const stub = createStub();
  const result = await runCollect(
    { date: '2025-06-01', sources: ['hacker_news'] },
    {
      repository: stub.repo,
      now: NOW,
      fetcher: async (source) => [rawItem(source, 1), rawItem(source, 2)],
      summarizer: async () => {
        throw new Error('llm timeout');
      },
    },
  );
  assert.equal(result.status, 'success');
  assert.equal(result.totals.inserted, 2);
  assert.equal(result.totals.summaryOk, 0);
  assert.equal(result.totals.summaryFailed, 2);
  assert.equal(stub.inserted.length, 2, 'LLM 失败不得丢弃条目');
  assert.deepEqual(stub.summaries.map((row) => row.summaryStatus), ['failed', 'failed']);
  assert.deepEqual(stub.summaries.map((row) => row.summary), [null, null]);
  assert.deepEqual(stub.summaries.map((row) => row.category), ['industry_news', 'industry_news']);
});

test('LLM 返回空摘要同样降级为 failed', async () => {
  const stub = createStub();
  const result = await runCollect(
    { date: '2025-06-01', sources: ['jiqizhixin'] },
    {
      repository: stub.repo,
      now: NOW,
      fetcher: async (source) => [rawItem(source, 1)],
      summarizer: async () => null,
    },
  );
  assert.equal(result.totals.summaryFailed, 1);
  assert.equal(stub.summaries[0].summaryStatus, 'failed');
  assert.equal(stub.inserted.length, 1);
});

test('单条摘要失败不阻塞其余条目（混合成功/失败）', async () => {
  const stub = createStub();
  let call = 0;
  const result = await runCollect(
    { date: '2025-06-01', sources: ['arxiv_cs_ai'] },
    {
      repository: stub.repo,
      now: NOW,
      fetcher: async (source) => [rawItem(source, 1), rawItem(source, 2)],
      summarizer: async () => {
        call += 1;
        if (call === 1) throw new Error('boom');
        return { summary: '这是一段中文摘要内容，用于验证成功分支。', category: 'research_paper' as Category };
      },
    },
  );
  assert.equal(result.status, 'success');
  assert.equal(result.totals.summaryOk, 1);
  assert.equal(result.totals.summaryFailed, 1);
  assert.deepEqual(stub.summaries.map((row) => row.summaryStatus), ['failed', 'ok']);
  assert.equal(stub.summaries[1].category, 'research_paper');
});

test('来源抓取失败重试上限 3 次且批次记为 failed', async () => {
  const stub = createStub();
  let calls = 0;
  const result = await runCollect(
    { date: '2025-06-01', sources: ['jiqizhixin'] },
    {
      repository: stub.repo,
      now: NOW,
      fetcher: async () => {
        calls += 1;
        throw new Error('network down');
      },
    },
  );
  assert.equal(MAX_ATTEMPTS, 3);
  assert.equal(calls, MAX_ATTEMPTS, '重试次数不得超过 3 次');
  assert.equal(result.status, 'failed');
  assert.equal(result.sources[0].status, 'failed');
  assert.equal(result.sources[0].attempts, 3);
  assert.equal(result.sources[0].error?.code, 'FETCH_FAILED');
  assert.equal(stub.sourceRuns[0].attempts, 3);
});

test('单来源失败不影响其它来源入库（partial_failure）', async () => {
  const stub = createStub();
  const result = await runCollect(
    { date: '2025-06-01', sources: ['hacker_news', 'arxiv_cs_ai'] },
    {
      repository: stub.repo,
      now: NOW,
      fetcher: async (source) => {
        if (source === 'arxiv_cs_ai') throw new Error('feed timeout');
        return [rawItem(source, 1)];
      },
      summarizer: async () => ({ summary: '中文摘要内容', category: 'model_release' as Category }),
    },
  );
  assert.equal(result.status, 'partial_failure');
  assert.equal(result.totals.inserted, 1);
  assert.equal(result.totals.summaryOk, 1);
  assert.equal(result.sources[0].status, 'success');
  assert.equal(result.sources[1].status, 'failed');
  assert.equal(result.sources[1].attempts, 3);
  assert.equal(stub.inserted.length, 1);
});

test('同一日期并发采集返回 COLLECT_IN_PROGRESS', async () => {
  const stub = createStub();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = runCollect(
    { date: '2025-07-01' },
    {
      repository: stub.repo,
      now: NOW,
      fetcher: async () => {
        await gate;
        return [];
      },
    },
  );
  await assert.rejects(
    runCollect({ date: '2025-07-01' }, { repository: stub.repo, now: NOW, fetcher: async () => [] }),
    (error: unknown) => (error as { code?: string }).code === 'COLLECT_IN_PROGRESS',
  );
  release();
  const finished = await first;
  assert.equal(finished.date, '2025-07-01');
});
