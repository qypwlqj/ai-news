import { createElement } from 'react';
import { notFound } from 'next/navigation';
import { getNewsRepository } from '../../../lib/db/repository';
import { categoryLabel, escapeHtml, formatShanghai, isSafeUrl, sourceLabel } from '../../../components/NewsCard';

export const dynamic = 'force-dynamic';

export interface DetailRenderResult {
  status: number;
  html: string;
}

function shell(title: string, content: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} · ai-news</title>
</head>
<body class="bg-white text-slate-900">
<header class="mx-auto flex max-w-[820px] items-center px-4 py-4">
<h1 class="text-xl font-semibold"><a href="/">ai-news</a></h1>
</header>
<main class="mx-auto max-w-[820px] px-4 pb-16">${content}</main>
</body>
</html>`;
}

interface NewsDetailView {
  status: number;
  title: string;
  content: string;
}

/** 只读详情页主体：字段缺失/摘要失败一律降级展示；不存在返回 404 空态。 */
export async function buildNewsDetail(id: string): Promise<NewsDetailView> {
  let record = null;
  try {
    record = id ? await getNewsRepository().getNewsById(id) : null;
  } catch {
    record = null;
  }
  if (!record) {
    return {
      status: 404,
      title: '资讯不存在',
      content:
        '<p class="text-sm text-slate-500">资讯不存在或已下线</p><p class="mt-4 text-sm"><a class="text-blue-600" href="/">返回首页</a></p>',
    };
  }
  const href = isSafeUrl(record.url) ? escapeHtml(record.url) : '';
  const publishedIso = record.publishedAt instanceof Date ? record.publishedAt.toISOString() : String(record.publishedAt);
  const summaryText = typeof record.summary === 'string' ? record.summary.trim() : '';
  const summary =
    record.summaryStatus === 'failed' || !summaryText
      ? '<p class="text-sm italic text-slate-500">摘要生成失败，可点击「阅读原文」查看内容</p>'
      : `<p class="whitespace-pre-line text-base leading-7 text-slate-700">${escapeHtml(summaryText)}</p>`;
  const content = `<nav class="mb-4 text-sm"><a class="text-blue-600" href="/">← 返回列表</a></nav>
<p class="mb-2 flex items-center gap-2 text-xs text-slate-500"><span class="rounded bg-slate-100 px-2 py-0.5">${escapeHtml(sourceLabel(record.source))}</span><time datetime="${escapeHtml(publishedIso)}">${escapeHtml(formatShanghai(record.publishedAt))}</time></p>
<h1 class="mb-3 text-2xl font-semibold leading-snug">${escapeHtml(record.title || '（无标题）')}</h1>
${summary}
<p class="mt-4 flex items-center gap-3 text-sm"><span class="rounded bg-slate-100 px-2 py-0.5 text-slate-600">${escapeHtml(categoryLabel(record.category))}</span>${href ? `<a class="text-blue-600" href="${href}" target="_blank" rel="noopener noreferrer">阅读原文 ↗</a>` : ''}</p>`;
  return { status: 200, title: record.title || '资讯详情', content };
}

/** 完整 HTML 文档（供运维/单测直接复用）。 */
export async function renderNewsDetail(id: string): Promise<DetailRenderResult> {
  const view = await buildNewsDetail(id);
  return { status: view.status, html: shell(view.title, view.content) };
}

/**
 * App Router 详情页：必须返回 ReactNode（不能直接返回 Response），
 * 详情片段由服务端构造后交给根 layout 包裹。
 */
export default async function Page({
  params,
}: {
  params?: Promise<{ id: string }> | { id: string };
} = {}) {
  const resolved = await params;
  const view = await buildNewsDetail(resolved?.id ?? '');
  if (view.status === 404) notFound();
  return createElement('div', { dangerouslySetInnerHTML: { __html: view.content } });
}
