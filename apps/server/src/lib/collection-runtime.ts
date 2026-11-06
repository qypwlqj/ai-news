import { runCollect, type CollectDeps } from './collect';
import { fetchSource } from './sources';
import { createHttpLlmClient } from './llm';
import { summarizeNews } from './summarize';
import { isSource } from './types';
import type { CollectExecutor } from './runtime';

/** Explicit dependency assembly; this module and all secrets remain server-side. */
export function createCollectExecutor(deps: CollectDeps): CollectExecutor {
  return async (body) => ({
    ...(await runCollect(
      { ...body, sources: body.sources?.filter(isSource) },
      deps,
    )),
  });
}

export function createDefaultCollectExecutor(
  env: Record<string, string | undefined> = process.env,
): CollectExecutor {
  const client =
    env.LLM_API_KEY && env.LLM_MODEL
      ? createHttpLlmClient({
          apiKey: env.LLM_API_KEY,
          model: env.LLM_MODEL,
          baseUrl: env.LLM_BASE_URL,
        })
      : null;
  return createCollectExecutor({
    fetcher: async (source) =>
      (await fetchSource(source, { retries: 0 })).map((item) => ({
        title: item.title,
        url: item.url,
        source: item.source,
        publishedAt: new Date(item.publishedAt),
        externalId: item.externalId,
        rawExcerpt: item.excerpt,
      })),
    summarizer: async (item) => {
      const result = await summarizeNews(
        { title: item.title, excerpt: item.rawExcerpt },
        client,
      );
      return result.summaryStatus === 'ok' && result.summary
        ? { summary: result.summary, category: result.category }
        : null;
    },
  });
}
