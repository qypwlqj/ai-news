import { CATEGORIES } from '../lib/types';
import { escapeHtml } from './NewsCard';

export interface CategoryOption {
  value: string;
  label: string;
  order: number;
}

/** 分类字典唯一真源为 lib/types 的 CATEGORIES（value/label/order），前端不硬编码。 */
export function categoryOptions(): CategoryOption[] {
  const raw = CATEGORIES as unknown;
  if (Array.isArray(raw)) return [...(raw as CategoryOption[])].sort((a, b) => a.order - b.order);
  return Object.entries(raw as Record<string, { label?: string; order?: number }>)
    .map(([value, meta]) => ({ value, label: meta?.label ?? value, order: meta?.order ?? 0 }))
    .sort((a, b) => a.order - b.order);
}

/** 分类 Chip 组：点击后 page 重置为 1，仅保留 category/date 查询参数。 */
export function categoryChipsHtml(active?: string | null, date?: string | null): string {
  const chips = [{ value: '', label: '全部', order: 0 }, ...categoryOptions()];
  const html = chips
    .map(({ value, label }) => {
      const params = new URLSearchParams();
      if (value) params.set('category', value);
      if (date) params.set('date', date);
      const qs = params.toString();
      const selected = (active ?? '') === value;
      const cls = selected ? 'chip chip--active bg-blue-600 text-white' : 'chip bg-slate-100 text-slate-700';
      const href = qs ? `/?${qs}` : '/';
      return `<a class="${cls} rounded-full px-3 py-1 text-sm" role="tab" aria-selected="${selected}" href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
    })
    .join('');
  return `<nav class="chips flex gap-2 overflow-x-auto whitespace-nowrap" role="tablist" aria-label="资讯分类">${html}</nav>`;
}
