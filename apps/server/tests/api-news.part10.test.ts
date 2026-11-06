import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryNewsRepository, loadNewsPage } from '../src/lib/db/repository';
import type { NewsItemRecord } from '../src/lib/types';

const BASE = Date.parse('2025-06-01T00:00:00.000Z');

/** 生成差异明显的标题，避免触发标题相似度去重（> 0.9）。 */
const TITLE_SUBJECTS = [
  'quantum',
  'robotic',
  'climate',
  'medical',
  'legal',
  'retail',
  'space',
  'energy',
  'biotech',
  'finance',
] as const;
const TITLE_OBJECTS = [
  'chip',
  'surgery',
  'policy',
  'imaging',
  'contract',
  'pricing',
  'probe',
  'storage',
  'trial',
  'ledger',
] as const;

function uniqueTitle(index: number): string {
  const subject = TITLE_SUBJECTS[index % TITLE_SUBJECTS.length];
  const object = TITLE_OBJECTS[Math.floor(index / TITLE_SUBJECTS.length) % TITLE_OBJECTS.length];
  return `${subject} ${object} item ${index} briefing`;
}

function item(index: number, overrides: Partial<NewsItemRecord> = {}): NewsItemRecord {
  return {
    id: `n${String(index).padStart(3, '0')}`,
    title: uniqueTitle(index),
    url: `https://example.com/a${index}`,
    normalizedUrl: `https://example.com/a${index}`,
    titleFingerprint: `fingerprint-${index}`,
    source: 'hacker_news',
    publishedAt: new Date(BASE - index * 60_000),
    summary: `摘要内容 ${index}`,
    summaryStatus: 'ok',
    category: index % 2 === 0 ? 'model_release' : 'research_paper',
    ...overrides,
  } as NewsItemRecord;
}

async function seeded(count: number): Promise<InMemoryNewsRepository> {
  const repo = new InMemoryNewsRepository();
  for (let i = 0; i < count; i += 1) {
    const result = await repo.insertNews(item(i));
    assert.equal(result.inserted, true);
  }
  return repo;
}

test('列表默认 limit=20 且按 publishedAt 倒序', async () => {
  const repo = await seeded(25);
  const page = await loadNewsPage(repo);
  assert.equal(page.limit, 20);
  assert.equal(page.items.length, 20);
  assert.equal(page.total, 25);
  assert.equal(page.items[0].id, 'n000');
  const times = page.items.map((entry) => entry.publishedAt.getTime());
  assert.deepEqual(times, [...times].sort((a, b) => b - a));
});

test('分类筛选只返回该分类的条目', async () => {
  const repo = await seeded(10);
  const page = await loadNewsPage(repo, { category: 'research_paper' });
  assert.ok(page.items.length > 0);
  assert.ok(page.items.every((entry) => entry.category === 'research_paper'));
  assert.equal(page.total, 5);
});

test('summaryStatus=failed 的条目仍出现在列表中', async () => {
  const repo = new InMemoryNewsRepository();
  await repo.insertNews(item(0, { summaryStatus: 'failed', summary: null }));
  const page = await loadNewsPage(repo, { category: 'model_release' });
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].summaryStatus, 'failed');
  assert.equal(page.items[0].summary, null);
  assert.equal(page.items[0].url, 'https://example.com/a0');
});

test('分页元数据 totalPages / hasNext 正确', async () => {
  const repo = await seeded(25);
  const first = await loadNewsPage(repo, { page: 1 });
  assert.equal(first.totalPages, 2);
  assert.equal(first.hasNext, true);
  const second = await loadNewsPage(repo, { page: 2 });
  assert.equal(second.items.length, 5);
  assert.equal(second.hasNext, false);
});

test('无数据时 totalPages=0 且 items 为空', async () => {
  const repo = new InMemoryNewsRepository();
  const page = await loadNewsPage(repo, { date: '2025-06-01' });
  assert.deepEqual(page.items, []);
  assert.equal(page.total, 0);
  assert.equal(page.totalPages, 0);
  assert.equal(page.hasNext, false);
  assert.equal(page.date, '2025-06-01');
});
