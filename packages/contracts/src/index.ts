/** Public, platform-neutral API contract. Never import server implementation here. */
export const CATEGORIES = [
  { value: 'model_release', label: '模型发布', order: 1 },
  { value: 'research_paper', label: '研究论文', order: 2 },
  { value: 'product_application', label: '产品应用', order: 3 },
  { value: 'industry_news', label: '行业动态', order: 4 },
  { value: 'policy_funding', label: '政策融资', order: 5 },
] as const;
export type Category = (typeof CATEGORIES)[number]['value'];
export const SOURCE_VALUES = [
  'hacker_news',
  'arxiv_cs_ai',
  'jiqizhixin',
] as const;
export type Source = (typeof SOURCE_VALUES)[number];
export const SOURCE_LABELS: Record<Source, string> = {
  hacker_news: 'Hacker News',
  arxiv_cs_ai: 'arXiv',
  jiqizhixin: '机器之心',
};
export interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  summary: string | null;
  summaryStatus: string;
  category: string;
}
export interface NewsPage {
  items: NewsItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  date: string | null;
}
export interface NewsFilters {
  category?: Category;
  source?: Source;
  date?: string;
  q?: string;
}
export interface NewsQuery extends NewsFilters {
  page?: number;
  limit?: number;
}
export interface ApiError {
  error: { code: string; message: string; requestId: string };
}

export function categoryLabel(value: string): string {
  return (
    CATEGORIES.find((item) => item.value === value)?.label ??
    (value || '未分类')
  );
}
export function sourceLabel(value: string): string {
  return Object.prototype.hasOwnProperty.call(SOURCE_LABELS, value)
    ? SOURCE_LABELS[value as Source]
    : value || '来源未知';
}
