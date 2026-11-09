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
  'x',
] as const;
export type Source = (typeof SOURCE_VALUES)[number];
export const SOURCE_LABELS: Record<Source, string> = {
  hacker_news: 'Hacker News',
  arxiv_cs_ai: 'arXiv',
  jiqizhixin: '机器之心',
  x: 'X',
};
/** 作者信息（目前仅 X 条目提供）。 */
export interface NewsAuthor {
  name: string;
  handle: string | null;
}
/** 列表与详情均可返回；新增字段全部可选，旧客户端可忽略。 */
export interface NewsItem {
  id: string;
  /** 展示标题：新加工条目为中文标题，旧数据可能是来源原标题。 */
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  summary: string | null;
  summaryStatus: string;
  category: string;
  /** 来源原标题；旧数据或无原标题时为 null/缺省。 */
  originalTitle?: string | null;
  /** 列表用原文片段（约 200 字截断）；无原文时为 null。 */
  excerpt?: string | null;
  /** 仅详情接口：完整原文片段（X 全文、arXiv 摘要等）。 */
  rawExcerpt?: string | null;
  author?: NewsAuthor | null;
}
export const NEWS_EXCERPT_MAX_CHARS = 200;
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
