import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SOURCE_CONFIG,
  MAX_EXCERPT_CHARS,
  collectArxiv,
  collectHackerNews,
  createSourceCollectors,
  parseArxivAtom,
  parseHackerNews,
  parseRssFeed,
} from '../src/app/news-sources';

const NOW = new Date('2025-06-02T00:00:00.000Z');

function okFetcher(body: string, seen: string[] = []) {
  return async (input: string) => {
    seen.push(input);
    return { ok: true, status: 200, text: async () => body };
  };
}

describe('parseHackerNews', () => {
  it('只保留 AI 相关标题，缺少 url 时回落到 HN 讨论页', () => {
    const payload = {
      hits: [
        { objectID: '1', title: 'New LLM released', url: 'https://example.com/a', created_at: '2025-06-01T00:00:00.000Z' },
        { objectID: '2', title: 'Ask HN: best coffee?', url: 'https://example.com/b', created_at: '2025-06-01T01:00:00.000Z' },
        { objectID: '3', title: 'An AI agent framework', created_at: '2025-06-01T02:00:00.000Z' },
      ],
    };
    const items = parseHackerNews(payload, { now: NOW });
    expect(items.map((item) => item.externalId)).toEqual(['1', '3']);
    expect(items[0]?.source).toBe('hacker_news');
    expect(items[0]?.publishedAt.toISOString()).toBe('2025-06-01T00:00:00.000Z');
    expect(items[1]?.url).toBe('https://news.ycombinator.com/item?id=3');
  });

  it('非法载荷返回空数组，非法时间回落到注入的 now', () => {
    expect(parseHackerNews(null)).toEqual([]);
    expect(parseHackerNews({ hits: [] })).toEqual([]);
    const items = parseHackerNews({ hits: [{ objectID: '4', title: 'AI without time' }] }, { now: NOW });
    expect(items[0]?.publishedAt).toEqual(NOW);
  });
});

describe('parseArxivAtom', () => {
  it('解析 entry 的标题、链接、发布时间与摘要', () => {
    const xml = [
      '<?xml version="1.0"?>',
      '<feed>',
      '<entry><id>http://arxiv.org/abs/2506.00001v1</id><published>2025-06-01T00:00:00Z</published>',
      '<title>Efficient &amp; Safe Agents</title>',
      '<link href="http://arxiv.org/abs/2506.00001v1" rel="alternate"/><summary>  abstract text </summary></entry>',
      '<entry><title>Second paper</title><link href="http://arxiv.org/abs/2506.00002v1"/></entry>',
      '</feed>',
    ].join('');
    const items = parseArxivAtom(xml, { now: NOW });
    expect(items).toHaveLength(2);
    expect(items[0]?.source).toBe('arxiv_cs_ai');
    expect(items[0]?.title).toBe('Efficient & Safe Agents');
    expect(items[0]?.rawExcerpt).toBe('abstract text');
    expect(items[0]?.externalId).toBe('http://arxiv.org/abs/2506.00001v1');
    expect(items[1]?.publishedAt).toEqual(NOW);
  });
});

describe('parseRssFeed', () => {
  it('解析 RSS item 并截断超长摘录', () => {
    const long = 'x'.repeat(MAX_EXCERPT_CHARS + 50);
    const rss = [
      '<rss><channel><item>',
      '<title>机器之心：模型发布</title>',
      '<link>https://www.jiqizhixin.com/articles/1</link>',
      '<guid>jqzx-1</guid>',
      '<pubDate>Sun, 01 Jun 2025 00:00:00 GMT</pubDate>',
      `<description>${long}</description>`,
      '</item></channel></rss>',
    ].join('');
    const items = parseRssFeed(rss, { now: NOW });
    expect(items).toHaveLength(1);
    expect(items[0]?.source).toBe('jiqizhixin');
    expect(items[0]?.url).toBe('https://www.jiqizhixin.com/articles/1');
    expect(items[0]?.externalId).toBe('jqzx-1');
    expect(items[0]?.publishedAt.toISOString()).toBe('2025-06-01T00:00:00.000Z');
    expect(items[0]?.rawExcerpt?.length).toBe(MAX_EXCERPT_CHARS);
  });

  it('无有效标题或链接的条目被跳过', () => {
    expect(parseRssFeed('<rss><channel><item><title>only title</title></item></channel></rss>')).toEqual([]);
  });
});

describe('collectors', () => {
  it('HN 采集使用配置化端点并复用解析结果', async () => {
    const seen: string[] = [];
    const body = JSON.stringify({
      hits: [{ objectID: '9', title: 'AI news', url: 'https://example.com/n', created_at: '2025-06-01T00:00:00.000Z' }],
    });
    const items = await collectHackerNews(okFetcher(body, seen));
    expect(items).toHaveLength(1);
    expect(seen[0]).toContain(DEFAULT_SOURCE_CONFIG.hackerNews.endpoint);
  });

  it('非 2xx 响应抛出携带来源与状态码的错误，编排层据此重试', async () => {
    await expect(collectHackerNews(async () => ({ ok: false, status: 503, text: async () => '' }))).rejects.toThrow(/503/);
  });

  it('逐源装配 3 个采集器，ArXiv 命中配置端点', async () => {
    const seen: string[] = [];
    const collectors = createSourceCollectors(okFetcher('<feed></feed>', seen));
    expect(Object.keys(collectors).sort()).toEqual(['arxiv_cs_ai', 'hacker_news', 'jiqizhixin']);
    expect(await collectors.arxiv_cs_ai()).toEqual([]);
    expect(seen[0]).toBe(DEFAULT_SOURCE_CONFIG.arxiv.endpoint);
    await expect(collectArxiv(async () => ({ ok: true, status: 200, text: async () => '<not-json' }))).resolves.toEqual([]);
  });

  it('默认配置不含任何凭据字样', () => {
    expect(JSON.stringify(DEFAULT_SOURCE_CONFIG)).not.toMatch(/secret|token|password|api[_-]?key/i);
  });
});
