/**
 * 接口契约类型与分类字典：Route Handler 与前端筛选的唯一真源。
 * 无 IO、不读环境变量；枚举只追加、不删除、不改名（对齐 docs/api.md 兼容规则）。
 */

export const NEWS_SOURCE_VALUES = ['hacker_news', 'arxiv_cs_ai', 'jiqizhixin'] as const;
export type NewsSource = (typeof NEWS_SOURCE_VALUES)[number];

export const SUMMARY_STATUS_VALUES = ['ok', 'failed', 'pending'] as const;
export type SummaryStatus = (typeof SUMMARY_STATUS_VALUES)[number];

/** 固定 5 项：value 与 category_enum 严格一致，order 即展示顺序。 */
export const CATEGORY_DICTIONARY = [
  { value: 'model_release', label: '模型发布', order: 1 },
  { value: 'research_paper', label: '研究论文', order: 2 },
  { value: 'product_application', label: '产品应用', order: 3 },
  { value: 'industry_news', label: '行业动态', order: 4 },
  { value: 'policy_funding', label: '政策融资', order: 5 },
] as const;

export type NewsCategory = (typeof CATEGORY_DICTIONARY)[number]['value'];
export interface CategoryOption {
  value: string;
  label: string;
  order: number;
}

export const CATEGORY_VALUES: readonly NewsCategory[] = CATEGORY_DICTIONARY.map(
  (item) => item.value,
);

/** 查表只用 Map，避免原型链继承属性（constructor/toString/__proto__）产出非字符串。 */
const CATEGORY_LABEL_BY_VALUE = new Map<string, string>(
  CATEGORY_DICTIONARY.map((item) => [item.value as string, item.label]),
);

export function isCategoryValue(value: string): value is NewsCategory {
  return CATEGORY_VALUES.includes(value as NewsCategory);
}

/** 未知值降级为原值文本（中性样式由展示层决定），绝不返回函数或对象。 */
export function categoryLabel(value: string): string {
  return CATEGORY_LABEL_BY_VALUE.get(value) ?? value;
}

/** 统一错误信封：code 为稳定机器码，message 已脱敏截断，requestId 供排障关联。 */
export type ApiErrorCode =
  | 'INVALID_DATE'
  | 'INVALID_CATEGORY'
  | 'INVALID_SOURCE'
  | 'INVALID_PAGINATION'
  | 'INVALID_ID'
  | 'INVALID_STATUS'
  | 'INVALID_RUN_ID'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NEWS_NOT_FOUND'
  | 'RUN_NOT_FOUND'
  | 'COLLECT_IN_PROGRESS'
  | 'ALL_SOURCES_FAILED'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; requestId: string };
}

/** 列表字段集合：二期小程序直接复用，不新增 Web 私有字段。 */
export interface NewsItemDto {
  id: string;
  title: string;
  url: string;
  source: string;
  publishedAt: string;
  summary: string | null;
  category: string;
  summaryStatus: string;
  createdAt?: string | null;
}

export interface NewsListResponseDto {
  items: NewsItemDto[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  date: string | null;
}
