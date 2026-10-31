import { createElement } from 'react';
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

interface HomeView {
  category: string | null;
  date: string | null;
  content: string;
}

/** 服务端渲染首页主体（分类栏 + 列表 + 分页），供整页 HTML 与 App Router 页面共用。 */
async function buildHomeView(search: URLSearchParams): Promise<HomeView> {
  const category = search.get('category');
  const date = search.get('date');
  const result = await listNews(search);
  const value = result.ok ? result.value : null;
  const items = (value?.items ?? []) as NewsCardItem[];
  const page = value?.page ?? 1;
  const body = result.ok
    ? newsListHtml(items)
    : '<p class="state state--error text-sm text-slate-500">加载失败，请稍后重试</p>';
  const content = `<section class="mb-4">${categoryChipsHtml(category, date)}</section>
${body}
${paginationHtml({ page, totalPages: value?.totalPages ?? 0, total: value?.total ?? 0, category, date })}`;
  return { category, date, content };
}

/** 服务端直出首页列表：URL query 同步 category/date/page，默认 limit=20。 */
export async function renderHomePage(search: URLSearchParams): Promise<string> {
  const { date, content } = await buildHomeView(search);
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
${content}
</main>
</body>
</html>`;
}

/**
 * App Router 首页：必须返回 ReactNode（不能直接返回 Response），
 * 这里复用服务端构造的列表片段并交给根 layout 包裹文档结构。
 */
export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<SearchParamsInput> | SearchParamsInput;
} = {}) {
  const { content } = await buildHomeView(toSearchParams(await searchParams));
  return createElement('div', { dangerouslySetInnerHTML: { __html: content } });
}
