import { CATEGORIES, SUMMARY_STATUS_VALUES, isCategory, isSource } from './types';
import type { Category, Source, SummaryStatus } from './types';

/** 中文文案字典：唯一真源为 `CATEGORIES`，前端不得硬编码 label 与 order。 */
export const ALL_CATEGORIES_LABEL = '全部';
export const UNKNOWN_SOURCE_LABEL = '来源未知';
export const UNKNOWN_CATEGORY_LABEL = '未分类';
export const UNKNOWN_SUMMARY_STATUS_LABEL = '摘要状态未知';

export const SOURCE_LABELS: Record<Source, string> = {
  hacker_news: 'Hacker News',
  arxiv_cs_ai: 'ArXiv cs.AI',
  jiqizhixin: '机器之心',
};

/** `ok` 不展示徽标，返回 null；未知状态降级为中性文案。 */
export const SUMMARY_STATUS_LABELS: Record<SummaryStatus, string | null> = {
  ok: null,
  pending: '摘要生成中',
  failed: '摘要生成失败',
};

export interface CategoryOption {
  value: Category;
  label: string;
  order: number;
}

function rawText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function findCategory(value: string | null | undefined): CategoryOption | null {
  if (!value || !isCategory(value)) return null;
  const found = CATEGORIES.find((item) => item.value === value);
  return found ? { value: found.value, label: found.label, order: found.order } : null;
}

/** 分类筛选项（含中文名与顺序），与 GET /api/categories 输出一致。 */
export function categoryOptions(): CategoryOption[] {
  return CATEGORIES.map((item) => ({ value: item.value, label: item.label, order: item.order }));
}

/** 未知分类降级为原值文本，不报错、不隐藏条目。 */
export function categoryLabel(value: string | null | undefined): string {
  const found = findCategory(value);
  if (found) return found.label;
  return rawText(value) || UNKNOWN_CATEGORY_LABEL;
}

export function categoryOrder(value: string | null | undefined): number {
  const found = findCategory(value);
  return found ? found.order : Number.MAX_SAFE_INTEGER;
}

export function sourceLabel(value: string | null | undefined): string {
  if (value && isSource(value)) return SOURCE_LABELS[value];
  return rawText(value) || UNKNOWN_SOURCE_LABEL;
}

export function summaryStatusLabel(value: string | null | undefined): string | null {
  if (!value || value === 'ok') return null;
  if (value === 'failed' || value === 'pending') return SUMMARY_STATUS_LABELS[value];
  return UNKNOWN_SUMMARY_STATUS_LABEL;
}

export function isKnownSummaryStatus(value: string | null | undefined): value is SummaryStatus {
  return !!value && SUMMARY_STATUS_VALUES.some((item) => item === value);
}
