import { describe, expect, it } from 'vitest';

import {
  CATEGORIES,
  DEFAULT_CATEGORY,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  SUMMARY_MAX_CHARS,
  SUMMARY_MIN_CHARS,
  categoryLabel,
  coerceCategory,
  listCategories,
  sourceLabel,
} from '../src/app/news-constants';
import {
  isIsoDate,
  shanghaiDayRangeUtc,
  shanghaiToday,
  toShanghaiDateString,
} from '../src/app/news-date';
import {
  CATEGORY_VALUES,
  SOURCE_VALUES,
  SUMMARY_STATUS_VALUES,
  isNewsCategory,
  isNewsSource,
  isSummaryStatus,
} from '../src/app/news-types';

describe('news-types 枚举', () => {
  it('固定 5 类分类、3 个来源与摘要三态', () => {
    expect(CATEGORY_VALUES).toHaveLength(5);
    expect(SOURCE_VALUES).toHaveLength(3);
    expect([...SUMMARY_STATUS_VALUES]).toEqual(['ok', 'failed', 'pending']);
  });

  it('守卫函数拒绝未知枚举值', () => {
    expect(isNewsCategory('model_release')).toBe(true);
    expect(isNewsCategory('other')).toBe(false);
    expect(isNewsSource('jiqizhixin')).toBe(true);
    expect(isNewsSource('weibo')).toBe(false);
    expect(isSummaryStatus('failed')).toBe(true);
    expect(isSummaryStatus(undefined)).toBe(false);
  });
});

describe('news-constants 分类字典', () => {
  it('顺序稳定且与 category_enum 一致', () => {
    expect(CATEGORIES.map((item) => item.value)).toEqual([...CATEGORY_VALUES]);
    expect(CATEGORIES.map((item) => item.order)).toEqual([1, 2, 3, 4, 5]);
    expect(CATEGORIES[0]).toEqual({ value: 'model_release', label: '模型发布', order: 1 });
  });

  it('listCategories 返回副本，改动不污染真源', () => {
    const items = listCategories();
    items[0].label = '改动';
    expect(CATEGORIES[0].label).toBe('模型发布');
  });

  it('未知分类兜底 industry_news，未知枚举降级为原值文本', () => {
    expect(coerceCategory('other')).toBe(DEFAULT_CATEGORY);
    expect(coerceCategory(undefined)).toBe('industry_news');
    expect(categoryLabel('unknown_value')).toBe('unknown_value');
    expect(sourceLabel('arxiv_cs_ai')).toBe('ArXiv cs.AI');
    expect(sourceLabel('unknown')).toBe('unknown');
  });

  it('分页与摘要边界常量与契约一致', () => {
    expect(DEFAULT_PAGE_LIMIT).toBe(20);
    expect(MAX_PAGE_LIMIT).toBe(100);
    expect(SUMMARY_MIN_CHARS).toBe(50);
    expect(SUMMARY_MAX_CHARS).toBe(200);
  });
});

describe('news-date 上海自然日 → UTC 半开区间', () => {
  it('isIsoDate 严格校验（含日历越界）', () => {
    expect(isIsoDate('2025-06-01')).toBe(true);
    expect(isIsoDate('2024-02-29')).toBe(true);
    for (const bad of ['2025-6-1', '2025-02-30', '2025-13-01', '2025-06-01T00:00:00Z', '', 'abc']) {
      expect(isIsoDate(bad)).toBe(false);
    }
  });

  it('date 换算为 [startUtc, endUtc) 且区间恒为 24h', () => {
    const { startUtc, endUtc } = shanghaiDayRangeUtc('2025-06-01');
    expect(startUtc.toISOString()).toBe('2025-05-31T16:00:00.000Z');
    expect(endUtc.toISOString()).toBe('2025-06-01T16:00:00.000Z');
    expect(endUtc.getTime() - startUtc.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('非法 date 直接抛错，不静默纠正', () => {
    expect(() => shanghaiDayRangeUtc('2025-02-30')).toThrow(RangeError);
  });

  it('UTC 16:00 为上海自然日分界', () => {
    expect(toShanghaiDateString(new Date('2025-05-31T15:59:59.999Z'))).toBe('2025-05-31');
    expect(toShanghaiDateString(new Date('2025-05-31T16:00:00.000Z'))).toBe('2025-06-01');
    expect(shanghaiToday(new Date('2025-06-01T03:00:00.000Z'))).toBe('2025-06-01');
  });
});
