import { describe, expect, it } from 'vitest';
import { CollectError, runCollect, shanghaiDate, type CollectDeps, type RawItem } from '../src/lib/collect';
import { InMemoryNewsRepository } from '../src/lib/db/repository';
import { DAILY_CRON_EXPRESSION, nextRunAt } from '../src/lib/schedule';
import type { Source } from '../src/lib/types';

const DATE = '2025-06-01';
const WORDS: Array<[string, string]> = [
  ['OpenAI', '推理模型发布'],
  ['DeepMind', '世界模型论文'],
  ['机器之心', '智能体融资'],
  ['Meta', '视觉编码器'],
  ['arXiv', '扩散采样加速'],
  ['Nvidia', '推理芯片'],
  ['欧盟', '人工智能法案'],
  ['Anthropic', '上下文协议'],
];

function raw(source: Source, index: number): RawItem {
  const [who, what] = WORDS[index % WORDS.length];
  return {
    source,
    // 标题带来源名：避免三来源同题被 AC3 的「标题相似度 > 0.9 只保留 1 条」软去重误伤夹具
    title: `${who} ${what} ${source}`,
    url: `https://example.com/${source}/${index}`,
    publishedAt: new Date(`${DATE}T02:00:00.000Z`),
    externalId: `${source}-${index}`,
  };
}

function fetcherFor(counts: Record<Source, number>) {
  return async (source: Source) => Array.from({ length: counts[source] }, (_, index) => raw(source, index));
}

describe('runCollect', () => {
  it('collects, dedups, summarises and records per-source logs', async () => {
    const repository = new InMemoryNewsRepository();
    const result = await runCollect({ date: DATE }, {
      repository,
      fetcher: fetcherFor({ hacker_news: 3, arxiv_cs_ai: 2, jiqizhixin: 2 }),
      summarizer: async (item) => {
        if (item.title.includes('推理芯片')) throw new Error('llm down');
        return { summary: '中文摘要'.repeat(20), category: 'research_paper' };
      },
    });

    expect(result.status).toBe('success');
    expect(result.totals.fetched).toBe(7);
    expect(result.totals.inserted).toBe(7);
    expect(result.totals.summaryOk + result.totals.summaryFailed).toBe(7);
    expect(result.sources.map((item) => item.source)).toEqual(['hacker_news', 'arxiv_cs_ai', 'jiqizhixin']);

    const list = await repository.listNews({ date: DATE });
    const failed = list.items.filter((item) => item.summaryStatus === 'failed');
    expect(failed.length).toBe(result.totals.summaryFailed);
    expect(failed.every((item) => item.summary === null && item.category === 'industry_news')).toBe(true);
    const log = await repository.getRun(result.runId);
    expect(log?.sources).toHaveLength(3);
  });

  it('retries a source up to 3 attempts and reports partial_failure', async () => {
    const repository = new InMemoryNewsRepository();
    let attempts = 0;
    const result = await runCollect({ date: DATE }, {
      repository,
      fetcher: async (source) => {
        if (source === 'arxiv_cs_ai') {
          attempts += 1;
          if (attempts < 3) throw new Error('boom');
          return [raw('arxiv_cs_ai', 0)];
        }
        throw new Error('offline');
      },
      summarizer: async () => ({ summary: '汇总'.repeat(30), category: 'research_paper' }),
    });

    expect(result.status).toBe('partial_failure');
    const arxiv = result.sources.find((item) => item.source === 'arxiv_cs_ai');
    expect(arxiv?.status).toBe('success');
    expect(arxiv?.attempts).toBe(3);
    const hn = result.sources.find((item) => item.source === 'hacker_news');
    expect(hn?.status).toBe('failed');
    expect(hn?.attempts).toBe(3);
    expect(hn?.error?.code).toBe('FETCH_FAILED');

    const allFailed = await runCollect({ date: '2025-06-02' }, {
      repository,
      fetcher: async () => {
        throw new Error('offline');
      },
    });
    expect(allFailed.status).toBe('failed');
  });

  it('short-circuits a day with a successful run unless force is set', async () => {
    const repository = new InMemoryNewsRepository();
    const deps: CollectDeps = {
      repository,
      fetcher: fetcherFor({ hacker_news: 1, arxiv_cs_ai: 1, jiqizhixin: 1 }),
    };
    await runCollect({ date: DATE }, deps);
    const second = await runCollect({ date: DATE }, deps);
    expect(second.status).toBe('success');
    expect(second.sources.every((item) => item.status === 'skipped')).toBe(true);
    const forced = await runCollect({ date: DATE, force: true }, deps);
    expect(forced.sources.every((item) => item.status === 'success')).toBe(true);
  });

  it('rejects a concurrent run for the same date', async () => {
    const repository = new InMemoryNewsRepository();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const deps: CollectDeps = {
      repository,
      fetcher: async () => {
        await gate;
        return [];
      },
    };
    const first = runCollect({ date: '2025-06-03' }, deps);
    await expect(runCollect({ date: '2025-06-03' }, deps)).rejects.toBeInstanceOf(CollectError);
    release();
    await expect(first).resolves.toMatchObject({ status: 'success' });
  });
});

describe('schedule', () => {
  it('computes the next 08:00 Asia/Shanghai run in UTC', () => {
    expect(DAILY_CRON_EXPRESSION).toBe('0 8 * * *');
    expect(nextRunAt(new Date('2025-05-31T23:00:00.000Z')).toISOString()).toBe('2025-06-01T00:00:00.000Z');
    expect(nextRunAt(new Date('2025-06-01T00:00:01.000Z')).toISOString()).toBe('2025-06-02T00:00:00.000Z');
  });

  it('resolves the Asia/Shanghai natural day', () => {
    expect(shanghaiDate(new Date('2025-05-31T16:30:00.000Z'))).toBe('2025-06-01');
    expect(shanghaiDate(new Date('2025-05-31T15:30:00.000Z'))).toBe('2025-05-31');
  });
});
