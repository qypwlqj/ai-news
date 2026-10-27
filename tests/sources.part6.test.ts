import { describe, expect, it } from 'vitest';
import type { FetchLike } from '../src/lib/http';
import { HACKER_NEWS_API, fetchHackerNews, isAiRelated, parseHackerNews } from '../src/lib/sources/hackernews';
import { parseArxivFeed } from '../src/lib/sources/arxiv';
import { parseJiqizhixinFeed } from '../src/lib/sources/jiqizhixin';
import {
  SOURCES,
  SOURCE_IDS,
  SOURCE_LABELS,
  fetchAllSources,
  fetchSource,
  getSourceAdapter,
  isSourceId,
  type SourceId,
} from '../src/lib/sources';

function fakeFetch(body: string, status = 200, calls: string[] = []): FetchLike {
  return async (url) => {
    calls.push(url);
    return { ok: status >= 200 && status < 300, status, text: async () => body };
  };
}

const NOW = new Date('2025-02-01T00:00:00Z');

const HN_PAYLOAD = {
  hits: [
    {
      objectID: 1,
      title: 'OpenAI ships GPT-6',
      url: 'https://example.com/gpt6',
      created_at: '2025-01-02T00:00:00Z',
    },
    {
      objectID: 2,
      title: 'Ask HN: good storage ideas',
      url: null,
      story_text: 'about databases and chairs',
      created_at: '2025-01-03T00:00:00Z',
    },
    {
      objectID: 3,
      title: 'RAG at scale',
      url: '',
      created_at: '2025-01-04T00:00:00Z',
    },
  ],
};

const ARXIV_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2501.00002v2</id>
    <published>2025-01-03T00:00:00Z</published>
    <title>Scaling Laws for Agents</title>
    <summary>We study &amp; scale agents.</summary>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2501.00001v1</id>
    <published>2025-01-02T00:00:00Z</published>
    <title>Older Paper</title>
    <summary>Older.</summary>
  </entry>
</feed>`;

const RSS_XML = `<rss version="2.0"><channel>
  <item>
    <title><![CDATA[大模型 &amp; 推理]]></title>
    <link>/articles/1</link>
    <guid>jx-1</guid>
    <pubDate>Wed, 01 Jan 2025 00:00:00 GMT</pubDate>
    <description><![CDATA[<p>机器之心摘要</p>]]></description>
  </item>
</channel></rss>`;

describe('hacker news 采集器', () => {
  it('按 AI 关键词过滤、补齐 HN 链接并按时间倒序', () => {
    const items = parseHackerNews(HN_PAYLOAD, { now: NOW });
    expect(items.map((item) => item.title)).toEqual(['RAG at scale', 'OpenAI ships GPT-6']);
    expect(items[0]?.url).toBe('https://news.ycombinator.com/item?id=3');
    expect(items[1]?.url).toBe('https://example.com/gpt6');
    expect(items[0]?.source).toBe('hacker_news');
    expect(items[0]?.externalId).toBe('3');
  });

  it('支持 limit 与缺失发布时间兜底', () => {
    const payload = { hits: [{ objectID: 9, title: 'LLM inference tips', url: 'https://e.com/x' }] };
    const items = parseHackerNews(payload, { now: NOW });
    expect(items).toHaveLength(1);
    expect(items[0]?.publishedAt).toBe(NOW.toISOString());
    expect(parseHackerNews(HN_PAYLOAD, { now: NOW, limit: 1 })).toHaveLength(1);
    expect(parseHackerNews({}, { now: NOW })).toEqual([]);
  });

  it('词边界匹配不误判', () => {
    expect(isAiRelated('RAG at scale')).toBe(true);
    expect(isAiRelated('good storage ideas')).toBe(false);
  });

  it('请求 Algolia 检索端点并传 accept 头', async () => {
    const calls: string[] = [];
    const items = await fetchHackerNews({
      fetchImpl: fakeFetch(JSON.stringify(HN_PAYLOAD), 200, calls),
      now: NOW,
    });
    expect(calls[0]).toBe(`${HACKER_NEWS_API}?query=AI&tags=story&hitsPerPage=200`);
    expect(items.length).toBeGreaterThan(0);
  });
});

describe('arxiv 采集器', () => {
  it('解析 Atom 条目，去掉版本号并重建 abs 链接', () => {
    const items = parseArxivFeed(ARXIV_XML, { now: NOW });
    expect(items).toHaveLength(2);
    expect(items[0]?.title).toBe('Scaling Laws for Agents');
    expect(items[0]?.externalId).toBe('2501.00002');
    expect(items[0]?.url).toBe('https://arxiv.org/abs/2501.00002');
    expect(items[0]?.publishedAt).toBe('2025-01-03T00:00:00.000Z');
    expect(items[0]?.excerpt).toBe('We study & scale agents.');
    expect(items[0]?.source).toBe('arxiv_cs_ai');
  });

  it('忽略缺失 id / title 的条目', () => {
    const xml = '<feed><entry><id>http://arxiv.org/abs/2501.00003v1</id></entry></feed>';
    expect(parseArxivFeed(xml, { now: NOW })).toEqual([]);
  });
});

describe('机器之心采集器', () => {
  it('解析 RSS，解 CDATA 与实体，相对链接补全为绝对地址', () => {
    const items = parseJiqizhixinFeed(RSS_XML, { now: NOW });
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe('大模型 & 推理');
    expect(items[0]?.url).toBe('https://www.jiqizhixin.com/articles/1');
    expect(items[0]?.excerpt).toBe('机器之心摘要');
    expect(items[0]?.externalId).toBe('jx-1');
    expect(items[0]?.publishedAt).toBe('2025-01-01T00:00:00.000Z');
    expect(items[0]?.source).toBe('jiqizhixin');
  });

  it('缺失 guid 时以链接作为来源内幂等键', () => {
    const xml = `<rss><channel><item><title>标题</title><link>https://www.jiqizhixin.com/articles/2</link></item></channel></rss>`;
    const items = parseJiqizhixinFeed(xml, { now: NOW });
    expect(items[0]?.externalId).toBe('https://www.jiqizhixin.com/articles/2');
  });
});

describe('来源注册表', () => {
  it('固定注册 3 个来源且标签稳定', () => {
    expect(SOURCE_IDS).toEqual(['hacker_news', 'arxiv_cs_ai', 'jiqizhixin']);
    expect(SOURCES.map((item) => item.source)).toEqual([...SOURCE_IDS]);
    expect(SOURCE_LABELS.arxiv_cs_ai).toBe('ArXiv cs.AI');
    expect(isSourceId('jiqizhixin')).toBe(true);
    expect(isSourceId('weibo')).toBe(false);
  });

  it('未知来源抛出可读错误', () => {
    expect(() => getSourceAdapter('weibo' as SourceId)).toThrow('unknown source: weibo');
  });

  it('fetchSource / fetchAllSources 路由到对应适配器', async () => {
    const calls: string[] = [];
    const items = await fetchSource('hacker_news', {
      fetchImpl: fakeFetch(JSON.stringify(HN_PAYLOAD), 200, calls),
      now: NOW,
    });
    expect(calls).toHaveLength(1);
    expect(items.every((item) => item.source === 'hacker_news')).toBe(true);

    const all = await fetchAllSources(
      { fetchImpl: fakeFetch(ARXIV_XML, 200), now: NOW },
      ['arxiv_cs_ai'],
    );
    expect(all.map((item) => item.source)).toEqual(['arxiv_cs_ai', 'arxiv_cs_ai']);
  });
});
