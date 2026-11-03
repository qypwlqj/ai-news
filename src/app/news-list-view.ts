/**
 * 首页列表视图模型：URL 参数校验与同步（分类 Chip / 分页）、时间倒序排序、分页控件（含「共 N 条」）。
 * 纯函数：不发请求、不读环境变量，数据获取由页面层（Server Component）负责。
 */

export const NEWS_LIST_DEFAULT_LIMIT = 20;

export const NEWS_LIST_CATEGORY_VALUES = [
  'model_release',
  'research_paper',
  'product_application',
  'industry_news',
  'policy_funding',
] as const;

export type NewsListCategory = (typeof NEWS_LIST_CATEGORY_VALUES)[number];

export interface NewsListItem {
  id?: string | null;
  title?: string | null;
  url?: string | null;
  source?: string | null;
  publishedAt?: string | null;
  summary?: string | null;
  category?: string | null;
  summaryStatus?: string | null;
}

export interface NewsListQuery {
  category?: string | null;
  date?: string | null;
  page?: number | string | null;
}

export interface NormalizedListQuery {
  category: NewsListCategory | null;
  date: string | null;
  page: number;
}

const CATEGORY_SET: ReadonlySet<string> = new Set<string>(NEWS_LIST_CATEGORY_VALUES);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function resolveListCategory(value: string | null | undefined): NewsListCategory | null {
  if (typeof value !== 'string') return null;
  const candidate = value.trim().toLowerCase();
  return CATEGORY_SET.has(candidate) ? (candidate as NewsListCategory) : null;
}

export function resolveListDate(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  if (!DATE_PATTERN.test(candidate)) return null;
  const parsed = new Date(`${candidate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === candidate ? candidate : null;
}

export function resolveListPage(value: number | string | null | undefined): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}

export function normalizeListQuery(input: NewsListQuery = {}): NormalizedListQuery {
  return {
    category: resolveListCategory(input.category),
    date: resolveListDate(input.date),
    page: resolveListPage(input.page),
  };
}

export function buildListHref(input: NewsListQuery = {}): string {
  const query = normalizeListQuery(input);
  const params = new URLSearchParams();
  if (query.category) params.set('category', query.category);
  if (query.date) params.set('date', query.date);
  if (query.page > 1) params.set('page', String(query.page));
  const search = params.toString();
  return search ? `/?${search}` : '/';
}

/** 切换分类：重置 page=1、保留 date；非法分类视为「全部」。 */
export function buildCategoryHref(input: NewsListQuery = {}, category: string | null | undefined): string {
  return buildListHref({ category: resolveListCategory(category), date: input.date, page: 1 });
}

function publishedTimestamp(value: string | null | undefined): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** 固定排序 publishedAt DESC, id DESC；非法时间置后，同键保持原顺序（稳定分页）。 */
export function sortNewsItemsForDisplay<T extends { publishedAt?: string | null; id?: string | null }>(
  items: readonly T[],
): T[] {
  return items
    .map((item, index) => ({ item, index, time: publishedTimestamp(item.publishedAt) }))
    .sort((left, right) => {
      if (left.time !== right.time) {
        if (left.time === null) return 1;
        if (right.time === null) return -1;
        return right.time - left.time;
      }
      const leftId = String(left.item.id ?? '');
      const rightId = String(right.item.id ?? '');
      if (leftId !== rightId) return rightId.localeCompare(leftId);
      return left.index - right.index;
    })
    .map((entry) => entry.item);
}

export interface PaginationInput {
  page?: number | string | null;
  total?: number | null;
  limit?: number | null;
  totalPages?: number | null;
  query?: NewsListQuery;
}

export interface PaginationView {
  totalLabel: string;
  page: number;
  total: number;
  totalPages: number;
  prevHref: string | null;
  nextHref: string | null;
  pageNumbers: Array<number | 'gap'>;
}

function toCount(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function pageWindow(page: number, totalPages: number): Array<number | 'gap'> {
  const candidates = new Set<number>([1, totalPages, page - 1, page, page + 1]);
  const visible = [...candidates].filter((value) => value >= 1 && value <= totalPages).sort((a, b) => a - b);
  const output: Array<number | 'gap'> = [];
  visible.forEach((value, index) => {
    if (index > 0 && value - (visible[index - 1] as number) > 1) output.push('gap');
    output.push(value);
  });
  return output;
}

export function buildPaginationView(input: PaginationInput = {}): PaginationView {
  const total = toCount(input.total);
  const limit = toCount(input.limit) || NEWS_LIST_DEFAULT_LIMIT;
  const declared = toCount(input.totalPages);
  const totalPages = declared > 0 ? declared : Math.max(1, Math.ceil(total / limit));
  const page = Math.min(Math.max(resolveListPage(input.page), 1), totalPages);
  const query = input.query ?? {};
  return {
    totalLabel: `共 ${total} 条`,
    page,
    total,
    totalPages,
    prevHref: page > 1 ? buildListHref({ ...query, page: page - 1 }) : null,
    nextHref: page < totalPages ? buildListHref({ ...query, page: page + 1 }) : null,
    pageNumbers: pageWindow(page, totalPages),
  };
}
