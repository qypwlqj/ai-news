import { listNews } from '../lib/query';
import { categoryChipsHtml } from '../components/CategoryChips';
import { escapeHtml, newsListHtml } from '../components/NewsCard';
import type { NewsCardItem } from '../components/NewsCard';
import { paginationHtml } from '../components/Pagination';

export const dynamic = 'force-dynamic';

export type SearchParamsInput = Record<string, string | string[] | undefined> | URLSearchParams | null | undefined;

export function toSearchParams(input: SearchParamsInput): URLSearchParams {
  if (input instanceof URLSearchParams) return input;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input ?? {})) {
    if (Array.isArray(value)) {
      if (value[0] !== undefined) params.set(key, value[0]);
    } else if (value !== undefined) {
      params.set(key, String(value));
    }
  }
  return params;
}

/** 服务端直出首页列表：URL query 同步 category/date/page，默认 limit=20。 */
export async function renderHomePage(search: URLSearchParams): Promise<string> {
  const category = search.get('category');
  const date = search.get('date');
  const result = await listNews(search);
  const value = result.ok ? result.value : null;
  const items = (value?.items ?? []) as NewsCardItem[];
  const page = value?.page ?? 1;
  const body = result.ok
    ? newsListHtml(items)
    : '<p class="state state--error text-sm text-slate-500">加载失败，请稍后重试</p>';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ai-news · AI 资讯</title>
</head>
<body class="bg-white text-slate-900">
<header class="mx-auto flex max-w-[1120px] items-center justify-between px-4 py-4">
<h1 class="text-xl font-semibold"><a href="/">ai-news</a></h1>
<p class="text-xs text-slate-500">${escapeHtml(date ?? '')}</p>
</header>
<main class="mx-auto max-w-[1120px] px-4 pb-16">
<section class="mb-4">${categoryChipsHtml(category, date)}</section>
${body}
${paginationHtml({ page, totalPages: value?.totalPages ?? 0, total: value?.total ?? 0, category, date })}
</main>
</body>
</html>`;
}

export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<SearchParamsInput> | SearchParamsInput;
} = {}): Promise<Response> {
  const html = await renderHomePage(toSearchParams(await searchParams));
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
