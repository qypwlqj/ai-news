import { describe, expect, it } from 'vitest';
import { runCollect } from '../src/lib/collect';
import type { RawItem } from '../src/lib/collect';
import { InMemoryNewsRepository } from '../src/lib/db/repository';

const item: RawItem = {
  title: 'OpenAI ships a new reasoning model for developers',
  url: 'https://example.com/news/1',
  source: 'hacker_news',
  publishedAt: new Date('2025-06-01T01:00:00.000Z'),
};

describe('采集编排：降级、重试与幂等', () => {
  it('LLM 调用超时：条目仍入库、summaryFailed=1，批次不中断', async () => {
    const repository = new InMemoryNewsRepository();
    const result = await runCollect(
      { date: '2025-06-01', sources: ['hacker_news'] },
      {
        repository,
        fetcher: async () => [item],
        summarizer: () => new Promise<never>(() => {}),
        summaryTimeoutMs: 10,
        now: () => new Date('2025-06-01T00:00:00.000Z'),
      },
    );
    expect(result.status).toBe('success');
    expect(result.totals.inserted).toBe(1);
    expect(result.totals.summaryOk).toBe(0);
    expect(result.totals.summaryFailed).toBe(1);
    expect(result.sources[0]?.status).toBe('success');
  });

  it('LLM 抛错：降级为 failed 且不影响其它来源计数', async () => {
    const repository = new InMemoryNewsRepository();
    const result = await runCollect(
      { date: '2025-06-04', sources: ['arxiv_cs_ai'] },
      {
        repository,
        fetcher: async () => [{ ...item, source: 'arxiv_cs_ai', url: 'https://example.com/news/2' }],
        summarizer: async () => {
          throw new Error('llm down');
        },
        now: () => new Date('2025-06-04T00:00:00.000Z'),
      },
    );
    expect(result.totals.inserted).toBe(1);
    expect(result.totals.summaryFailed).toBe(1);
    expect(result.status).toBe('success');
  });

  it('单源失败最多尝试 3 次并记录 attempts/error', async () => {
    const repository = new InMemoryNewsRepository();
    let calls = 0;
    const result = await runCollect(
      { date: '2025-06-02', sources: ['jiqizhixin'] },
      {
        repository,
        fetcher: async () => {
          calls += 1;
          throw new Error('fetch boom');
        },
        now: () => new Date('2025-06-02T00:00:00.000Z'),
      },
    );
    expect(calls).toBe(3);
    expect(result.sources[0]?.attempts).toBe(3);
    expect(result.sources[0]?.status).toBe('failed');
    expect(result.sources[0]?.error?.message).toContain('fetch boom');
    expect(result.status).toBe('failed');
  });

  it('当日已有成功批次且未 force：sources 全部 skipped', async () => {
    const repository = new InMemoryNewsRepository();
    const deps = {
      repository,
      fetcher: async () => [item],
      now: () => new Date('2025-06-03T00:00:00.000Z'),
    };
    await runCollect({ date: '2025-06-03', sources: ['hacker_news'] }, deps);
    const second = await runCollect({ date: '2025-06-03', sources: ['hacker_news'] }, deps);
    expect(second.status).toBe('success');
    expect(second.sources[0]?.status).toBe('skipped');
    expect(second.totals.inserted).toBe(0);
  });
});
