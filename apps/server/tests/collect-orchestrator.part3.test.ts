import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COLLECT_CONFIG,
  MAX_ATTEMPTS,
  fetchSourceItems,
  parseArxiv,
  parseHackerNews,
  parseJiqizhixin,
  runCollect,
  sanitizeError,
  type CollectConfig,
  type CollectStore,
  type CollectRunPatch,
  type RawNewsItem,
  type SourceRunRecord,
} from '../src/app/news-collect';

const HN_JSON = JSON.stringify({
  hits: [
    { objectID: '1', title: 'New AI model released', url: 'https://example.com/a', created_at: '2025-06-01T00:00:00.000Z' },
    { objectID: '2', title: 'Cooking tips', url: 'https://example.com/b', created_at: '2025-06-01T01:00:00.000Z' },
    { objectID: '3', title: 'AI without link', url: '', created_at: '2025-06-01T02:00:00.000Z' },
  ],
});

const ARXIV_XML =
  '<feed><id>feed-id</id>' +
  '<entry><id>http://arxiv.org/abs/1</id><title>Paper One</title><published>2025-06-01T00:00:00Z</published></entry>' +
  '<entry><id>http://arxiv.org/abs/2</id><title><![CDATA[Paper &amp; Two]]></title><published>2025-06-02T00:00:00Z</published></entry>' +
  '</feed>';

const RSS_XML =
  '<rss><channel><item><title>机器之心头条</title><link>https://jiqizhixin.com/a</link><guid>g1</guid>' +
  '<pubDate>Sun, 01 Jun 2025 00:00:00 GMT</pubDate><description><![CDATA[<p>摘要片段</p>]]></description></item>' +
  '</channel></rss>';

const CONFIG: CollectConfig = { ...DEFAULT_COLLECT_CONFIG, jiqizhixin: { feedUrl: 'https://example.com/rss' } };

function createStore(existing: { runId: string } | null = null) {
  const calls = { created: [] as unknown[], sources: [] as SourceRunRecord[], finished: [] as CollectRunPatch[] };
  const store: CollectStore = {
    async findSuccessfulRun() {
      return existing;
    },
    async createRun(run) {
      calls.created.push(run);
    },
    async saveSourceRun(_runId, record) {
      calls.sources.push(record);
    },
    async finishRun(_runId, patch) {
      calls.finished.push(patch);
    },
  };
  return { store, calls };
}

function okFetcher(text: string) {
  return async () => ({ ok: true, status: 200, text: async () => text });
}

function routeFetcher(map: Record<string, string>) {
  return async (url: string) => {
    const key = Object.keys(map).find((fragment) => url.includes(fragment));
    if (!key) throw new Error('HTTP_500');
    const body = map[key];
    return { ok: true, status: 200, text: async () => body };
  };
}

const ingestAll = async (): Promise<{ inserted: number; duplicates: number; summaryOk: number; summaryFailed: number }> => ({
  inserted: 20,
  duplicates: 2,
  summaryOk: 19,
  summaryFailed: 1,
});

describe('来源解析', () => {
  it('Hacker News 只保留命中关键词且有 http(s) 地址的条目', () => {
    const items = parseHackerNews(HN_JSON, ['AI'], 10);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ externalId: '1', url: 'https://example.com/a', title: 'New AI model released' });
    expect(items[0].publishedAt).toBe('2025-06-01T00:00:00.000Z');
  });

  it('ArXiv 解析多条 entry 并升级为 https', () => {
    const items = parseArxiv(ARXIV_XML, 10);
    expect(items.map((item) => item.url)).toEqual(['https://arxiv.org/abs/1', 'https://arxiv.org/abs/2']);
    expect(items[1].title).toBe('Paper & Two');
  });

  it('机器之心 RSS 解析标题/链接/guid 与摘要片段', () => {
    const items = parseJiqizhixin(RSS_XML);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ externalId: 'g1', url: 'https://jiqizhixin.com/a', rawExcerpt: '摘要片段' });
  });

  it('缺少机器之心 feed 配置时抛 CONFIG_MISSING_FEED_URL', async () => {
    await expect(
      fetchSourceItems('jiqizhixin', { fetcher: okFetcher(RSS_XML), config: DEFAULT_COLLECT_CONFIG }),
    ).rejects.toThrow('CONFIG_MISSING_FEED_URL');
  });
});

describe('采集编排', () => {
  it('三来源成功时返回 success 并汇总 totals', async () => {
    const { store, calls } = createStore();
    const result = await runCollect(
      {
        store,
        config: CONFIG,
        fetcher: routeFetcher({ 'hn.algolia.com': HN_JSON, 'export.arxiv.org': ARXIV_XML, 'example.com/rss': RSS_XML }),
        ingest: ingestAll,
        newRunId: () => 'run-1',
      },
      { trigger: 'api', date: '2025-06-01' },
    );
    expect(result.status).toBe('success');
    expect(result.httpStatus).toBe(200);
    expect(result.sources).toHaveLength(3);
    expect(result.totals).toEqual({ fetched: expect.any(Number), inserted: 60, duplicates: 6, summaryOk: 57, summaryFailed: 3 });
    expect(calls.finished[0].status).toBe('success');
  });

  it('单源失败重试至声明次数并记为 partial_failure', async () => {
    const { store } = createStore();
    let hnCalls = 0;
    const fetcher = async (url: string) => {
      if (url.includes('hn.algolia.com')) {
        hnCalls += 1;
        throw new Error('HTTP_503');
      }
      const body = url.includes('export.arxiv.org') ? ARXIV_XML : RSS_XML;
      return { ok: true, status: 200, text: async () => body };
    };
    const result = await runCollect(
      { store, config: CONFIG, fetcher, ingest: ingestAll },
      { trigger: 'cron', date: '2025-06-01' },
    );
    expect(hnCalls).toBe(MAX_ATTEMPTS);
    const hn = result.sources.find((item) => item.source === 'hacker_news');
    expect(hn).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS, errorCode: 'HTTP_503' });
    expect(result.status).toBe('partial_failure');
    expect(result.httpStatus).toBe(200);
  });

  it('全部来源失败时 status=failed 且 httpStatus=502', async () => {
    const { store } = createStore();
    const result = await runCollect(
      {
        store,
        config: CONFIG,
        fetcher: async () => {
          throw new Error('HTTP_500');
        },
        ingest: ingestAll,
      },
      { trigger: 'cron', date: '2025-06-01', sources: ['hacker_news', 'arxiv_cs_ai'] },
    );
    expect(result.status).toBe('failed');
    expect(result.httpStatus).toBe(502);
    expect(result.sources.every((item) => item.attempts === MAX_ATTEMPTS)).toBe(true);
  });

  it('当日已有成功批次且未 force 时幂等短路为 skipped', async () => {
    const { store, calls } = createStore({ runId: 'previous' });
    const fetcher = async () => {
      throw new Error('SHOULD_NOT_FETCH');
    };
    const result = await runCollect({ store, config: CONFIG, fetcher, ingest: ingestAll }, { trigger: 'api', date: '2025-06-01' });
    expect(result.status).toBe('success');
    expect(result.sources.map((item) => item.status)).toEqual(['skipped', 'skipped', 'skipped']);
    expect(calls.sources).toHaveLength(3);
  });

  it('force=true 跳过幂等短路并新增批次', async () => {
    const { store, calls } = createStore({ runId: 'previous' });
    const result = await runCollect(
      {
        store,
        config: CONFIG,
        fetcher: routeFetcher({ 'hn.algolia.com': HN_JSON, 'export.arxiv.org': ARXIV_XML, 'example.com/rss': RSS_XML }),
        ingest: ingestAll,
      },
      { trigger: 'api', date: '2025-06-01', force: true },
    );
    expect(calls.created).toHaveLength(1);
    expect(result.sources.some((item) => item.status === 'skipped')).toBe(false);
  });

  it('错误信息脱敏并截断', () => {
    const sanitized = sanitizeError(new Error(`token=abcdef123 ${'x'.repeat(3000)}`));
    expect(sanitized.message).not.toContain('abcdef123');
    expect(sanitized.message.length).toBeLessThanOrEqual(2000);
    expect(sanitized.code).toBe('SOURCE_ERROR');
  });

  it('ingest 抛错时该源记为 failed 但其他来源照常', async () => {
    const { store } = createStore();
    const result = await runCollect(
      {
        store,
        config: CONFIG,
        fetcher: routeFetcher({ 'hn.algolia.com': HN_JSON, 'export.arxiv.org': ARXIV_XML, 'example.com/rss': RSS_XML }),
        ingest: async (source: string, _items: RawNewsItem[]) => {
          if (source === 'hacker_news') throw new Error('DB_WRITE_FAILED');
          return { inserted: 1, duplicates: 0, summaryOk: 1, summaryFailed: 0 };
        },
      },
      { trigger: 'cron', date: '2025-06-01' },
    );
    expect(result.status).toBe('partial_failure');
    expect(result.sources.find((item) => item.source === 'hacker_news')).toMatchObject({
      status: 'failed',
      errorCode: 'DB_WRITE_FAILED',
    });
  });
});
