import { describe, expect, it } from 'vitest';
import { InMemoryNewsRepository } from '../src/lib/db/repository';
import {
  ingestXBatch,
  parseXIngestDocument,
  X_INGEST_MAX_BATCH,
  X_ALLOWED_HOSTS,
} from '../src/lib/x-ingest';

describe('x ingest contract', () => {
  it('rejects oversized batches and disallowed hosts', () => {
    expect(() =>
      parseXIngestDocument({
        items: Array.from({ length: X_INGEST_MAX_BATCH + 1 }, (_, i) => ({
          postId: String(i),
          url: `https://x.com/a/status/${i}`,
          authorHandle: 'a',
          authorDisplayName: 'A',
          publishedAt: '2026-11-06T00:00:00.000Z',
          text: 'hello AI',
          summary: '中文摘要不少于十字以上的内容用于通过长度校验一二三',
          category: 'industry_news',
        })),
      }),
    ).toThrow(/batch/i);

    expect(() =>
      parseXIngestDocument({
        items: [
          {
            postId: '1',
            url: 'https://evil.example/status/1',
            authorHandle: 'a',
            authorDisplayName: 'A',
            publishedAt: '2026-11-06T00:00:00.000Z',
            text: 'hello',
            summary: '中文摘要不少于十字以上的内容用于通过长度校验一二三',
            category: 'industry_news',
          },
        ],
      }),
    ).toThrow(/url|host/i);
    expect(X_ALLOWED_HOSTS.has('x.com')).toBe(true);
  });

  it('inserts x items idempotently and returns receipt counts', async () => {
    const repo = new InMemoryNewsRepository();
    const doc = parseXIngestDocument({
      items: [
        {
          postId: '198',
          url: 'https://x.com/openai/status/198',
          authorHandle: 'openai',
          authorDisplayName: 'OpenAI',
          publishedAt: '2026-11-06T01:00:00.000Z',
          text: 'Shipping a safer model update for developers.',
          summary: 'OpenAI 发布面向开发者的安全模型更新，强调可靠性与可控性。',
          category: 'model_release',
          title: 'Safer model update',
        },
      ],
    });
    const first = await ingestXBatch(repo, doc.items);
    expect(first).toEqual({ inserted: 1, skipped: 0, errors: [] });
    const second = await ingestXBatch(repo, doc.items);
    expect(second).toEqual({ inserted: 0, skipped: 1, errors: [] });
    const listed = await repo.listNews({ source: 'x' as never });
    expect(listed.total).toBe(1);
    expect(listed.items[0].source).toBe('x');
    expect(listed.items[0].externalId).toBe('198');
    expect(listed.items[0].summaryStatus).toBe('ok');
  });

  it('requires author fields from the payload and does not fabricate them', () => {
    expect(() =>
      parseXIngestDocument({
        items: [
          {
            postId: '2',
            url: 'https://twitter.com/a/status/2',
            publishedAt: '2026-11-06T00:00:00.000Z',
            text: 'AI news',
            summary: '中文摘要不少于十字以上的内容用于通过长度校验一二三',
            category: 'industry_news',
          },
        ],
      }),
    ).toThrow(/authorHandle|authorDisplayName/i);
  });
});

describe('candidate feed mapping', () => {
  it('maps snake_case candidate posts without fabricating authors', async () => {
    const { mapCandidateFeedToIngestDocument, ingestXBatch } = await import('../src/lib/x-ingest');
    const doc = mapCandidateFeedToIngestDocument({
      items: [
        {
          post_id: '2118390190246879554',
          url: 'https://x.com/OpenAI/status/2118390190246879554',
          author: { handle: 'OpenAI', name: 'OpenAI', id: '1' },
          published_at: '2026-11-05T17:09:13.000Z',
          original_text: 'Introducing GPT-6 Cyber for security research.',
          summary_zh: 'OpenAI 官方宣布面向安全研究的模型更新，强调对齐与能力进展。',
          title_zh: 'OpenAI 发布安全研究模型更新',
          topics: ['model', 'security'],
        },
      ],
    });
    expect(doc.items[0].postId).toBe('2118390190246879554');
    expect(doc.items[0].authorHandle).toBe('OpenAI');
    expect(doc.items[0].category).toBe('model_release');
    const repo = new InMemoryNewsRepository();
    const receipt = await ingestXBatch(repo, doc.items);
    expect(receipt.inserted).toBe(1);
  });
});
