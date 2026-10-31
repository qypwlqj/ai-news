/**
 * 常量与字典：分类字典（value/label/order）是 GET /api/categories 的唯一真源，
 * 前端与接口都从这里取，禁止硬编码 label 与顺序。
 */

import {
  CATEGORY_VALUES,
  isNewsCategory,
  type CategoryOption,
  type NewsCategory,
  type NewsSource,
} from './news-types';

/** 上海固定 +08:00（无夏令时）。 */
export const SHANGHAI_TIME_ZONE = 'Asia/Shanghai';
export const SHANGHAI_OFFSET_MINUTES = 8 * 60;
export const DAY_MS = 24 * 60 * 60 * 1000;

/** 分页：默认 limit=20 语义冻结；上限 100。 */
export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

/** 去重：标题相似度严格大于 0.9 判为重复；候选窗口近 7 天。 */
export const TITLE_SIMILARITY_THRESHOLD = 0.9;
export const TITLE_DEDUP_WINDOW_DAYS = 7;

/** 摘要长度按中文字符计 50–200 字。 */
export const SUMMARY_MIN_CHARS = 50;
export const SUMMARY_MAX_CHARS = 200;

/** 分类兜底（保证 category 命中率 100%）、单源最大尝试次数、错误文案截断上限。 */
export const DEFAULT_CATEGORY: NewsCategory = 'industry_news';
export const MAX_SOURCE_ATTEMPTS = 3;
export const ERROR_MESSAGE_MAX_CHARS = 2000;

/** 固定 5 项，order 1–5，与 category_enum 一一对应。 */
export const CATEGORIES: readonly CategoryOption[] = Object.freeze([
  { value: 'model_release', label: '模型发布', order: 1 },
  { value: 'research_paper', label: '研究论文', order: 2 },
  { value: 'product_application', label: '产品应用', order: 3 },
  { value: 'industry_news', label: '行业动态', order: 4 },
  { value: 'policy_funding', label: '政策融资', order: 5 },
]);

export const CATEGORY_LABELS: Readonly<Record<NewsCategory, string>> = Object.freeze(
  CATEGORIES.reduce<Record<NewsCategory, string>>((acc, item) => {
    acc[item.value] = item.label;
    return acc;
  }, {} as Record<NewsCategory, string>),
);

export const SOURCE_LABELS: Readonly<Record<NewsSource, string>> = Object.freeze({
  hacker_news: 'Hacker News',
  arxiv_cs_ai: 'ArXiv cs.AI',
  jiqizhixin: '机器之心',
});

/** 分类无法判定（缺失/未知枚举）时兜底 industry_news。 */
export function coerceCategory(value: unknown): NewsCategory {
  return isNewsCategory(value) ? value : DEFAULT_CATEGORY;
}

/** 返回分类字典副本，调用方改动不污染真源。 */
export function listCategories(): CategoryOption[] {
  return CATEGORIES.map((item) => ({ ...item }));
}

/** 未知枚举降级为原值文本，不报错、不隐藏条目。 */
export function categoryLabel(value: string): string {
  return (CATEGORY_LABELS as Record<string, string>)[value] ?? value;
}

export function sourceLabel(value: string): string {
  return (SOURCE_LABELS as Record<string, string>)[value] ?? value;
}

/** 供测试/校验：字典 value 顺序必须与 category_enum 完全一致。 */
export const CATEGORY_VALUE_ORDER: readonly string[] = CATEGORY_VALUES;
