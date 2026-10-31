import { escapeHtml } from './NewsCard';

export interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  category?: string | null;
  date?: string | null;
}

function pageHref(page: number, category?: string | null, date?: string | null): string {
  const params = new URLSearchParams();
  if (category) params.set('category', category);
  if (date) params.set('date', date);
  if (page > 1) params.set('page', String(page));
  const qs = params.toString();
  return qs ? `/?${qs}` : '/';
}

/** 分页控件：limit 固定默认 20，totalPages ≤ 1 时整段隐藏。 */
export function paginationHtml({ page, totalPages, total, category, date }: PaginationProps): string {
  if (!Number.isFinite(totalPages) || totalPages <= 1) return '';
  const current = Math.min(Math.max(1, page || 1), totalPages);
  const prev =
    current > 1
      ? `<a class="page-link text-blue-600" href="${escapeHtml(pageHref(current - 1, category, date))}" rel="prev">上一页</a>`
      : '<span class="page-link page-link--disabled text-slate-400">上一页</span>';
  const next =
    current < totalPages
      ? `<a class="page-link text-blue-600" href="${escapeHtml(pageHref(current + 1, category, date))}" rel="next">下一页</a>`
      : '<span class="page-link page-link--disabled text-slate-400">下一页</span>';
  return `<nav class="pagination mt-8 flex items-center justify-center gap-4 text-sm" aria-label="分页">${prev}<span class="pagination__status text-slate-500">第 ${current} / ${totalPages} 页 · 共 ${total} 条</span>${next}</nav>`;
}
