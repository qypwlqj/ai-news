export interface NewsCardItem {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  summary: string | null;
  category: string;
  summaryStatus?: string;
}

const SOURCE_LABELS: Record<string, string> = {
  hacker_news: 'Hacker News',
  arxiv_cs_ai: 'ArXiv cs.AI',
  jiqizhixin: '机器之心',
};

const CATEGORY_LABELS: Record<string, string> = {
  model_release: '模型发布',
  research_paper: '研究论文',
  product_application: '产品应用',
  industry_news: '行业动态',
  policy_funding: '政策融资',
};

const MAX_SUMMARY_LENGTH = 160;

/** 未知枚举值降级为原值文本，不报错、不隐藏条目。 */
export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? (source || '来源未知');
}

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? (category || '未分类');
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 仅接受 http/https 绝对地址，其它协议降级为不可跳转。 */
export function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function formatShanghai(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function truncateText(text: string, max: number = MAX_SUMMARY_LENGTH): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/** 摘要三态：ok 正常截断展示；pending 骨架文案；failed/空 展示占位且条目仍可见可点。 */
export function summaryHtml(summary: string | null | undefined, summaryStatus?: string): string {
  const text = typeof summary === 'string' ? summary.trim() : '';
  if (summaryStatus === 'pending') {
    return '<p class="summary summary--pending text-sm text-slate-400">摘要生成中…</p>';
  }
  if (summaryStatus === 'failed' || !text) {
    return '<p class="summary summary--failed text-sm italic text-slate-500">摘要生成失败，可点击标题阅读原文</p>';
  }
  return `<p class="summary line-clamp-3 text-sm leading-6 text-slate-600">${escapeHtml(truncateText(text))}</p>`;
}

export function newsCardHtml(item: NewsCardItem): string {
  const href = isSafeUrl(item.url) ? escapeHtml(item.url) : '#';
  const title = escapeHtml(item.title || '（无标题）');
  return `<li class="news-card rounded-lg border border-slate-200 p-4 shadow-sm"><div class="news-card__meta mb-2 flex items-center gap-2 text-xs text-slate-500"><span class="badge badge--source rounded bg-slate-100 px-2 py-0.5">${escapeHtml(sourceLabel(item.source))}</span><time datetime="${escapeHtml(item.publishedAt)}">${escapeHtml(formatShanghai(item.publishedAt))}</time></div><h2 class="news-card__title mb-2 text-base font-semibold leading-6"><a href="${href}" target="_blank" rel="noopener noreferrer">${title} <span aria-hidden="true">↗</span></a></h2>${summaryHtml(item.summary, item.summaryStatus)}<div class="news-card__footer mt-3 flex items-center gap-3 text-xs"><span class="badge badge--category rounded bg-slate-100 px-2 py-0.5 text-slate-600">${escapeHtml(categoryLabel(item.category))}</span><a class="text-blue-600" href="/news/${encodeURIComponent(item.id)}">查看详情</a></div></li>`;
}

export function newsListHtml(items: NewsCardItem[]): string {
  if (items.length === 0) return '<p class="state text-sm text-slate-500">该分类今日暂无资讯</p>';
  return `<ul class="news-list flex list-none flex-col gap-4 p-0">${items.map(newsCardHtml).join('')}</ul>`;
}
