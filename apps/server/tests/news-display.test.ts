import { afterEach, describe, expect, it } from 'vitest';
import { buildSummaryPrompt, parseLlmOutput } from '../src/lib/llm';
import { summarizeNews } from '../src/lib/summarize';
import { runCollect, type RawItem } from '../src/lib/collect';
import { InMemoryNewsRepository, setNewsRepository } from '../src/lib/db/repository';
import { PostgresNewsRepository } from '../src/lib/db/postgres-repository';
import { toNewsItemDto, listNews } from '../src/lib/query';
import { GET as getDetail } from '../src/api/news/[id]/route';
import type { NewsItemRecord } from '../src/lib/types';

const SUMMARY =
  '研究团队发布了一个新的开源推理模型，在数学与代码基准上显著提升，同时降低了推理成本，并公开了训练细节与评测数据，便于社区复现和进一步改进。';

function llmJson(extra: Record<string, unknown>): string {
  return JSON.stringify({ summary: SUMMARY, category: 'model_release', ...extra });
}

describe('LLM 中文标题 title_zh', () => {
  it('prompt 要求输出 title_zh 中文标题', () => {
    const prompt = buildSummaryPrompt({ title: 'New open model', excerpt: null });
    expect(prompt).toContain('title_zh');
  });

  it('解析出合法的中文标题', () => {
    const parsed = parseLlmOutput(llmJson({ title_zh: '  开源推理模型发布，数学与代码能力大幅提升 ' }));
    expect(parsed?.titleZh).toBe('开源推理模型发布，数学与代码能力大幅提升');
    expect(parsed?.summary).toBe(SUMMARY);
  });

  it('title_zh 缺失、非中文、过长或类型错误时为 null，但摘要仍然有效', () => {
    for (const extra of [{}, { title_zh: '' }, { title_zh: 'English only title' }, { title_zh: '长'.repeat(81) }, { title_zh: 42 }]) {
      const parsed = parseLlmOutput(llmJson(extra));
      expect(parsed).not.toBeNull();
      expect(parsed?.titleZh).toBeNull();
      expect(parsed?.summary).toBe(SUMMARY);
    }
  });

  it('summarizeNews 返回 titleZh（LLM 已 mock）', async () => {
    const result = await summarizeNews({ title: 'x' }, { complete: async () => llmJson({ title_zh: '新模型发布' }) });
    expect(result.summaryStatus).toBe('ok');
    expect(result.titleZh).toBe('新模型发布');
  });
});

const DATE = '2026-11-09';
function rawItem(index: number, title: string): RawItem {
  return {
    source: 'hacker_news',
    title,
    url: `https://example.com/story/${index}`,
    publishedAt: new Date(`${DATE}T02:00:00.000Z`),
    externalId: `hn-${index}`,
    rawExcerpt: index === 1 ? 'Original body text' : null,
  };
}

describe('采集写入：中文标题与原标题', () => {
  it('新条目 title=中文标题，originalTitle=来源原标题', async () => {
    const repository = new InMemoryNewsRepository();
    await runCollect(
      { date: DATE, sources: ['hacker_news'] },
      {
        repository,
        fetcher: async () => [rawItem(1, 'OpenAI ships a new reasoning model')],
        summarizer: async () => ({ summary: SUMMARY, category: 'model_release', titleZh: 'OpenAI 发布新推理模型' }),
      },
    );
    const { items } = await repository.listNews({});
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('OpenAI 发布新推理模型');
    expect(items[0].originalTitle).toBe('OpenAI ships a new reasoning model');
    expect(items[0].summaryStatus).toBe('ok');
  });

  it('titleZh 缺失或摘要失败时保留原标题，originalTitle 记录原标题', async () => {
    const repository = new InMemoryNewsRepository();
    let call = 0;
    await runCollect(
      { date: DATE, sources: ['hacker_news'] },
      {
        repository,
        fetcher: async () => [rawItem(1, 'Alpha agent framework released'), rawItem(2, 'Quantum chips and diffusion samplers')],
        summarizer: async () => (call++ === 0 ? { summary: SUMMARY, category: 'model_release' } : null),
      },
    );
    const { items } = await repository.listNews({});
    const byUrl = new Map(items.map((item) => [item.url, item]));
    const first = byUrl.get('https://example.com/story/1')!;
    const second = byUrl.get('https://example.com/story/2')!;
    expect(first.title).toBe('Alpha agent framework released');
    expect(first.originalTitle).toBe('Alpha agent framework released');
    expect(first.summaryStatus).toBe('ok');
    expect(second.title).toBe('Quantum chips and diffusion samplers');
    expect(second.originalTitle).toBe('Quantum chips and diffusion samplers');
    expect(second.summaryStatus).toBe('failed');
  });

  it('换成中文标题后，同一英文标题的转载仍按原标题判重', async () => {
    const repository = new InMemoryNewsRepository();
    const deps = {
      repository,
      summarizer: async () => ({ summary: SUMMARY, category: 'model_release' as const, titleZh: '全新开源推理模型发布' }),
    };
    await runCollect({ date: DATE, sources: ['hacker_news'] }, { ...deps, fetcher: async () => [rawItem(1, 'OpenAI ships a new reasoning model')] });
    const result = await runCollect(
      { date: '2026-11-10', sources: ['hacker_news'] },
      { ...deps, fetcher: async () => [rawItem(9, 'OpenAI ships a new reasoning model!')] },
    );
    expect(result.totals.duplicates).toBe(1);
    expect(result.totals.inserted).toBe(0);
  });
});

function record(overrides: Partial<NewsItemRecord>): NewsItemRecord {
  return {
    id: 'n1',
    title: 'Old english title',
    url: 'https://example.com/a',
    normalizedUrl: 'https://example.com/a',
    titleFingerprint: 'abcd1234',
    source: 'hacker_news',
    publishedAt: new Date('2026-11-09T00:00:00.000Z'),
    summary: SUMMARY,
    summaryStatus: 'ok',
    category: 'industry_news',
    ...overrides,
  };
}

describe('列表 DTO 展示字段', () => {
  it('旧数据：originalTitle/excerpt/author 均为 null，原有字段不变', () => {
    const dto = toNewsItemDto(record({}));
    expect(dto.title).toBe('Old english title');
    expect(dto.originalTitle).toBeNull();
    expect(dto.excerpt).toBeNull();
    expect(dto.author).toBeNull();
    expect(dto.summary).toBe(SUMMARY);
  });

  it('excerpt 截断到 200 字并加省略号；短原文原样返回', () => {
    const long = '字'.repeat(250);
    expect(toNewsItemDto(record({ rawExcerpt: long })).excerpt).toBe('字'.repeat(200) + '…');
    expect(toNewsItemDto(record({ rawExcerpt: '  short body  ' })).excerpt).toBe('short body');
    expect(toNewsItemDto(record({ rawExcerpt: '   ' })).excerpt).toBeNull();
  });

  it('X 条目返回作者信息与原标题', () => {
    const dto = toNewsItemDto(
      record({
        source: 'x',
        originalTitle: 'Original',
        rawExcerpt: 'full post',
        metadata: { authorHandle: 'sama', authorDisplayName: 'Sam Altman' },
      }),
    );
    expect(dto.originalTitle).toBe('Original');
    expect(dto.author).toEqual({ name: 'Sam Altman', handle: 'sama' });
  });
});

describe('详情与搜索', () => {
  afterEach(() => setNewsRepository(null));

  it('详情返回完整 rawExcerpt 与 author', async () => {
    const repository = new InMemoryNewsRepository();
    setNewsRepository(repository);
    const text = 'p'.repeat(600);
    await repository.insertNews(
      record({ id: 'x_1', source: 'x', rawExcerpt: text, metadata: { authorHandle: 'karpathy', authorDisplayName: 'Andrej' } }),
    );
    const response = await getDetail(new Request('http://t/api/news/x_1'), { params: Promise.resolve({ id: 'x_1' }) });
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.rawExcerpt).toBe(text);
    expect(body.author).toEqual({ name: 'Andrej', handle: 'karpathy' });
    expect(body.originalTitle).toBeNull();
  });

  it('关键词搜索也匹配原标题', async () => {
    const repository = new InMemoryNewsRepository();
    setNewsRepository(repository);
    await repository.insertNews(record({ title: '新推理模型发布', originalTitle: 'Reasoning model ships' }));
    const result = await listNews(new URLSearchParams({ q: 'reasoning' }));
    expect(result.ok && result.value.total).toBe(1);
  });
});

describe('Postgres 仓储', () => {
  it('saveSummary 带 title 时同时更新 title 与 original_title', async () => {
    const calls: Array<{ sql: string; params?: readonly unknown[] }> = [];
    const repo = new PostgresNewsRepository({
      query: async (sql, params) => {
        calls.push({ sql, params });
        return { rows: [], rowCount: 0 };
      },
      close: async () => {},
    });
    await repo.saveSummary('n1', { summary: SUMMARY, category: 'model_release', summaryStatus: 'ok', title: '中文标题', originalTitle: 'English' });
    expect(calls[0].sql).toMatch(/title = COALESCE\(\$5, title\)/);
    expect(calls[0].sql).toMatch(/original_title = COALESCE\(\$6, original_title\)/);
    expect(calls[0].params).toEqual(['n1', SUMMARY, 'model_release', 'ok', '中文标题', 'English']);
  });

  it('关键词搜索与标题判重使用原标题', async () => {
    const calls: string[] = [];
    const repo = new PostgresNewsRepository({
      query: async (sql) => {
        calls.push(sql);
        return { rows: sql.includes('COUNT(*)') ? [{ total: 0 }] : [], rowCount: 0 };
      },
      close: async () => {},
    });
    await repo.listNews({ q: 'model' });
    expect(calls[0]).toContain("LOWER(COALESCE(original_title, ''))");
    calls.length = 0;
    await repo.insertNews(record({}));
    expect(calls.some((sql) => sql.includes('COALESCE(original_title, title)'))).toBe(true);
  });
});
