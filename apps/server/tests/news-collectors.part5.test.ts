import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COLLECTOR_MAX_ATTEMPTS,
  COLLECTOR_SOURCE_VALUES,
  HACKER_NEWS_SOURCE,
  buildHackerNewsUrl,
  createHackerNewsCollector,
  fetchText,
  isAiRelatedTitle,
  parseHackerNews,
  sanitizeCollectError,
  truncateExcerpt,
  type Fetcher,
  type FetcherResponse,
} from '../src/app/news-collectors';

function textResponse(body: string, status = 200): FetcherResponse {
  return { ok: status >= 200 && status < 300, status, text: async () => body };
}

const NOW = new Date('2025-06-01T00:00:00.000Z');

const HN_PAYLOAD = {
  hits: [
    {
      objectID: '1',
      title: 'OpenAI releases new GPT model',
      url: 'https://example.com/a',
      created_at: '2025-05-31T10:00:00.000Z',
      points: 120,
    },
    {
      objectID: '2',
      title: 'Daily maintenance: rain in Spain',
      url: 'https://example.com/b',
      created_at: '2025-05-31T11:00:00.000Z',
      points: 200,
    },
    {
      objectID: '3',
      title: 'LLM inference at scale',
      url: 'https://example.com/c',
      created_at: '2025-05-31T12:00:00.000Z',
      points: 5,
    },
    {
      objectID: 4,
      title: 'AI agents in production',
      story_url: 'https://example.com/d',
      created_at: 'not-a-date',
      points: 42,
    },
    { objectID: '5', title: 'Neural rendering', url: 'ftp://example.com/e', points: 99 },
  ],
};

test('source 枚举与 Collector 契约对齐 source_enum 三值', () => {
  assert.deepEqual([...COLLECTOR_SOURCE_VALUES], ['hacker_news', 'arxiv_cs_ai', 'jiqizhixin']);
  const collector = createHackerNewsCollector({ now: () => NOW });
  assert.equal(collector.source, HACKER_NEWS_SOURCE);
  assert.equal(typeof collector.fetchItems, 'function');
});

test('fetchText 首次成功即返回 body，不重试', async () => {
  let calls = 0;
  const fetcher: Fetcher = async () => {
    calls += 1;
    return textResponse('{"hits":[]}');
  };
  const result = await fetchText(fetcher, 'https://example.com/feed');
  assert.deepEqual(result, { ok: true, body: '{"hits":[]}' });
  assert.equal(calls, 1);
});

test('fetchText 失败自动重试且最多 3 次，返回脱敏错误码', async () => {
  let calls = 0;
  const fetcher: Fetcher = async () => {
    calls += 1;
    throw new Error('socket hang up Authorization: Bearer abcdef123456');
  };
  const result = await fetchText(fetcher, 'https://example.com/feed');
  assert.equal(calls, COLLECTOR_MAX_ATTEMPTS);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errorCode, 'FETCH_FAILED');
    assert.ok(!result.message.includes('abcdef123456'));
  }
});

test('fetchText 第二次成功即停止重试', async () => {
  let calls = 0;
  const fetcher: Fetcher = async () => {
    calls += 1;
    if (calls === 1) throw new Error('temporary failure');
    return textResponse('ok');
  };
  const result = await fetchText(fetcher, 'https://example.com/feed');
  assert.equal(calls, 2);
  assert.equal(result.ok, true);
});

test('fetchText 超时返回 FETCH_TIMEOUT，maxAttempts 可下调', async () => {
  let calls = 0;
  const fetcher: Fetcher = () => {
    calls += 1;
    return new Promise<FetcherResponse>(() => {});
  };
  const result = await fetchText(fetcher, 'https://example.com/slow', { timeoutMs: 5, maxAttempts: 2 });
  assert.equal(calls, 2);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.errorCode, 'FETCH_TIMEOUT');
});

test('fetchText HTTP 非 2xx 返回 FETCH_HTTP_ERROR 并带状态码', async () => {
  const fetcher: Fetcher = async () => textResponse('boom', 500);
  const result = await fetchText(fetcher, 'https://example.com/feed', { maxAttempts: 1 });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.errorCode, 'FETCH_HTTP_ERROR');
    assert.ok(result.message.includes('HTTP 500'));
  }
});

test('sanitizeCollectError 脱敏令牌与连接串并截断 ≤ 200 字', () => {
  const raw = `Authorization: Bearer sk-live-abcdef token=abc123 postgres://user:pw@db:5432/app ${'x'.repeat(500)}`;
  const message = sanitizeCollectError(raw);
  assert.ok(!message.includes('sk-live-abcdef'));
  assert.ok(!message.includes('abc123'));
  assert.ok(!message.includes('postgres://'));
  assert.ok(message.length <= 200);
  assert.ok(message.endsWith('…'));
  assert.equal(sanitizeCollectError(''), 'unknown error');
});

test('truncateExcerpt 去标签并把原文摘录截断到 2000 字', () => {
  const long = `<p>${'a'.repeat(3000)}</p>`;
  const excerpt = truncateExcerpt(long);
  assert.equal(excerpt.length, 2000);
  assert.ok(!excerpt.includes('<p>'));
  assert.ok(excerpt.endsWith('…'));
});

test('isAiRelatedTitle 按词边界命中，避免 rain/spain 误判', () => {
  assert.equal(isAiRelatedTitle('OpenAI ships GPT-5'), true);
  assert.equal(isAiRelatedTitle('AI agents in production'), true);
  assert.equal(isAiRelatedTitle('Daily maintenance: rain in Spain'), false);
  assert.equal(isAiRelatedTitle('Baking sourdough at home'), false);
});

test('parseHackerNews 过滤非 AI / 低热度 / 非法 URL，并映射字段', () => {
  const items = parseHackerNews(HN_PAYLOAD, { now: () => NOW });
  assert.equal(items.length, 2);
  const [first, second] = items;
  assert.equal(first?.externalId, '1');
  assert.equal(first?.source, 'hacker_news');
  assert.equal(first?.url, 'https://example.com/a');
  assert.equal(first?.publishedAt.toISOString(), '2025-05-31T10:00:00.000Z');
  assert.equal(second?.externalId, '4');
  assert.equal(second?.url, 'https://example.com/d');
  assert.equal(second?.publishedAt.toISOString(), NOW.toISOString());
  assert.equal(second?.rawExcerpt, 'AI agents in production');
});

test('parseHackerNews 忽略缺失/非法 payload 与批内重复 URL', () => {
  assert.deepEqual(parseHackerNews(null), []);
  assert.deepEqual(parseHackerNews({ hits: 'nope' }), []);
  const duplicated = {
    hits: [
      { objectID: '1', title: 'LLM news', url: 'https://example.com/x', points: 50 },
      { objectID: '2', title: 'LLM news again', url: 'https://EXAMPLE.com/x', points: 50 },
    ],
  };
  assert.equal(parseHackerNews(duplicated, { now: () => NOW }).length, 1);
});

test('buildHackerNewsUrl 使用配置化 limit 且保留已有查询串', () => {
  assert.ok(buildHackerNewsUrl().includes('hitsPerPage=100'));
  assert.equal(buildHackerNewsUrl({ limit: 5 }), 'https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=5');
  assert.equal(buildHackerNewsUrl({ limit: 5, baseUrl: 'https://x.test/s?q=ai' }), 'https://x.test/s?q=ai&tags=story&hitsPerPage=5');
});

test('createHackerNewsCollector 成功解析，失败返回脱敏错误码', async () => {
  const okCollector = createHackerNewsCollector({ now: () => NOW });
  const okResult = await okCollector.fetchItems(async () => textResponse(JSON.stringify(HN_PAYLOAD)));
  assert.equal(okResult.ok, true);
  if (okResult.ok) assert.equal(okResult.items.length, 2);

  const failing = await okCollector.fetchItems(async () => {
    throw new Error('dial tcp failed password=hunter2');
  });
  assert.equal(failing.ok, false);
  if (!failing.ok) {
    assert.equal(failing.errorCode, 'FETCH_FAILED');
    assert.ok(!failing.message.includes('hunter2'));
  }

  const badJson = await okCollector.fetchItems(async () => textResponse('<html>oops</html>'));
  assert.equal(badJson.ok, false);
  if (!badJson.ok) assert.equal(badJson.errorCode, 'FETCH_INVALID_PAYLOAD');
});
