import { afterEach, expect, it, vi } from 'vitest';
import { handleRequest } from '../src/http';
import { setCollectExecutor, setRuntimeConfig } from '../src/lib/runtime';
import { setNewsRepository } from '../src/lib/db/repository';

afterEach(() => {
  setNewsRepository(null);
  setCollectExecutor(null);
  setRuntimeConfig(null);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it('preserves the public read API and rejects unsupported methods', async () => {
  const response = await handleRequest(
    new Request('http://localhost/api/news?q=AI'),
  );
  expect(response.status).toBe(200);
  expect((await response.json()).items).toEqual([]);
  const invalid = await handleRequest(
    new Request('http://localhost/api/news?date=bad'),
  );
  expect(invalid.status).toBe(400);
  const method = await handleRequest(
    new Request('http://localhost/api/news', { method: 'POST' }),
  );
  expect(method.status).toBe(405);
  expect(method.headers.get('allow')).toBe('GET');
});

it('the real default executor assembles source fetching and summary fallback', async () => {
  setRuntimeConfig({ cronSecret: 'local-test' });
  vi.stubEnv('LLM_API_KEY', '');
  vi.stubEnv('LLM_MODEL', '');
  const upstream = vi.fn(async () =>
    Response.json({
      hits: [
        {
          objectID: '1',
          title: 'AI reasoning research',
          url: 'https://example.com/one',
          created_at: '2026-11-06T00:00:00Z',
        },
      ],
    }),
  );
  vi.stubGlobal('fetch', upstream);
  const response = await handleRequest(
    new Request('http://localhost/api/cron/collect', {
      method: 'POST',
      headers: {
        authorization: 'Bearer local-test',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ sources: ['hacker_news'], date: '2026-11-06' }),
    }),
  );
  expect(response.status).toBe(200);
  const batch = await response.json();
  expect(batch.totals.inserted).toBe(1);
  expect(batch.totals.summaryFailed).toBe(1);
  expect(upstream).toHaveBeenCalledTimes(1);
  const list = await (
    await handleRequest(new Request('http://localhost/api/news'))
  ).json();
  expect(list.items[0].summaryStatus).toBe('failed');
  const detail = await handleRequest(
    new Request(`http://localhost/api/news/${list.items[0].id}`),
  );
  expect(detail.status).toBe(200);
});

it('collection authentication precedes any source fetch', async () => {
  setRuntimeConfig({ cronSecret: 'local-test' });
  const upstream = vi.fn();
  vi.stubGlobal('fetch', upstream);
  expect(
    (
      await handleRequest(
        new Request('http://localhost/api/cron/collect', { method: 'POST' }),
      )
    ).status,
  ).toBe(401);
  expect(upstream).not.toHaveBeenCalled();
});
