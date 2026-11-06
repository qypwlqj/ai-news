import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createArxivCollector,
  createJiqizhixinCollector,
  DEFAULT_ARXIV_CONFIG,
  DEFAULT_JIQIZHIXIN_CONFIG,
  parseArxivFeed,
  parseJiqizhixinFeed,
  stripHtml,
} from '../src/app/news-collector-arxiv';

const ARXIV_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2401.00001v1</id>
    <published>2025-06-01T00:00:00Z</published>
    <title>Scaling Laws &amp; AI</title>
    <summary>&lt;p&gt;一段中文摘要&lt;/p&gt;</summary>
    <link href="http://arxiv.org/abs/2401.00001v1" rel="alternate" type="text/html"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2401.00002v1</id>
    <published>2025-06-01T01:00:00Z</published>
    <title>   </title>
  </entry>
  <entry>
    <id>ftp://example.com/not-http</id>
    <published>2025-06-01T02:00:00Z</published>
    <title>Bad link</title>
  </entry>
</feed>`;

const JQZ_XML = `<rss version="2.0"><channel>
  <item>
    <title>机器之心 &amp; 大模型</title>
    <link>https://www.jiqizhixin.com/articles/1</link>
    <pubDate>Sun, 01 Jun 2025 00:00:00 GMT</pubDate>
    <guid>jqz-1</guid>
    <description><![CDATA[<p>正文片段</p>]]></description>
  </item>
  <item>
    <title>无链接</title>
    <pubDate>Sun, 01 Jun 2025 00:00:00 GMT</pubDate>
  </item>
  <item>
    <title>坏日期</title>
    <link>https://www.jiqizhixin.com/articles/3</link>
    <pubDate>not-a-date</pubDate>
  </item>
</channel></rss>`;

test('parseArxivFeed 解析合法条目并跳过非法条目', () => {
  const result = parseArxivFeed(ARXIV_XML);
  assert.equal(result.items.length, 1);
  assert.equal(result.skipped, 2);
  const [item] = result.items;
  assert.equal(item.source, 'arxiv_cs_ai');
  assert.equal(item.title, 'Scaling Laws & AI');
  assert.equal(item.url, 'http://arxiv.org/abs/2401.00001v1');
  assert.equal(item.externalId, '2401.00001v1');
  assert.equal(item.publishedAt.toISOString(), '2025-06-01T00:00:00.000Z');
  assert.equal(item.rawExcerpt, '一段中文摘要');
});

test('parseArxivFeed 遵守 maxItems 上限', () => {
  const result = parseArxivFeed(ARXIV_XML, 1);
  assert.equal(result.items.length, 1);
  const zero = parseArxivFeed(ARXIV_XML, 0);
  assert.equal(zero.items.length, 0);
});

test('parseJiqizhixinFeed 解码实体、剥离 CDATA 并跳过缺失字段', () => {
  const result = parseJiqizhixinFeed(JQZ_XML);
  assert.equal(result.items.length, 1);
  assert.equal(result.skipped, 2);
  const [item] = result.items;
  assert.equal(item.source, 'jiqizhixin');
  assert.equal(item.title, '机器之心 & 大模型');
  assert.equal(item.externalId, 'jqz-1');
  assert.equal(item.rawExcerpt, '正文片段');
  assert.equal(item.publishedAt.toISOString(), '2025-06-01T00:00:00.000Z');
});

test('stripHtml 去标签、解码实体并压缩空白', () => {
  assert.equal(stripHtml('<p>a&nbsp;&amp;&nbsp;b</p>'), 'a & b');
});

test('采集器使用配置化的 feed 地址并透传 fetcher', async () => {
  const calls: string[] = [];
  const fetcher = async (url: string): Promise<string> => {
    calls.push(url);
    return JQZ_XML;
  };
  const collector = createJiqizhixinCollector({ feedUrl: 'https://feed.example.com/jqz.xml', maxItems: 5 });
  const result = await collector.fetchItems(fetcher);
  assert.deepEqual(calls, ['https://feed.example.com/jqz.xml']);
  assert.equal(result.items.length, 1);
  assert.equal(collector.source, 'jiqizhixin');
});

test('ArXiv 采集器默认端点配置化且抓取失败向上抛出', async () => {
  const collector = createArxivCollector();
  assert.equal(collector.source, 'arxiv_cs_ai');
  assert.equal(DEFAULT_ARXIV_CONFIG.feedUrl, 'https://rss.arxiv.org/atom/cs.AI');
  assert.equal(DEFAULT_JIQIZHIXIN_CONFIG.maxItems, 50);
  await assert.rejects(() => collector.fetchItems(async () => Promise.reject(new Error('boom'))), /boom/);
  const ok = await collector.fetchItems(async () => ARXIV_XML);
  assert.equal(ok.items.length, 1);
});
