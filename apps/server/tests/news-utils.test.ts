import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '../src/app/news-constants';
import { isIsoDate, shanghaiDayRangeUtc, toShanghaiDateString } from '../src/app/news-date';
import { isSimilarTitle, normalizeUrl } from '../src/app/news-dedup';
import { sanitizeMessage, truncateMessage } from '../src/app/news-errors';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function toMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') return Date.parse(value);
  throw new Error(`unsupported date value: ${String(value)}`);
}

function boundsOf(date: string): { start: number; end: number } {
  const range = shanghaiDayRangeUtc(date) as unknown as {
    startUtc?: unknown;
    endUtc?: unknown;
    start?: unknown;
    end?: unknown;
  };
  return { start: toMs(range.startUtc ?? range.start), end: toMs(range.endUtc ?? range.end) };
}

describe('news-date：Asia/Shanghai 自然日 -> UTC 半开区间', () => {
  it('按 +08:00 换算，起点为前一日 16:00Z 且区间长度为 24h', () => {
    const { start, end } = boundsOf('2025-06-01');
    expect(start).toBe(Date.parse('2025-05-31T16:00:00.000Z'));
    expect(end).toBe(Date.parse('2025-06-01T16:00:00.000Z'));
    expect(end - start).toBe(DAY_MS);
  });

  it('跨年日期同样按半开区间换算', () => {
    const { start, end } = boundsOf('2025-01-01');
    expect(start).toBe(Date.parse('2024-12-31T16:00:00.000Z'));
    expect(end).toBe(Date.parse('2025-01-01T16:00:00.000Z'));
  });

  it('isIsoDate 只接受 YYYY-MM-DD 形态', () => {
    expect(isIsoDate('2025-06-01')).toBe(true);
    expect(isIsoDate('2025-6-1')).toBe(false);
    expect(isIsoDate('2025/06/01')).toBe(false);
    expect(isIsoDate('')).toBe(false);
  });

  it('toShanghaiDateString 按上海时区跨日边界输出日期', () => {
    expect(toShanghaiDateString(new Date('2025-05-31T16:00:00.000Z'))).toBe('2025-06-01');
    expect(toShanghaiDateString(new Date('2025-05-31T15:59:59.999Z'))).toBe('2025-05-31');
  });
});

describe('news-constants：分类字典', () => {
  it('固定 5 项、顺序与中文展示名齐备', () => {
    expect(CATEGORIES.map((item) => item.value)).toEqual([
      'model_release',
      'research_paper',
      'product_application',
      'industry_news',
      'policy_funding',
    ]);
    expect(CATEGORIES.map((item) => item.order)).toEqual([1, 2, 3, 4, 5]);
    expect(CATEGORIES.every((item) => typeof item.label === 'string' && item.label.length > 0)).toBe(true);
  });
});

describe('news-dedup：URL 规范化与标题相似度', () => {
  it('去掉追踪参数、fragment 与尾斜杠，小写主机，且幂等', () => {
    const normalized = normalizeUrl('https://Example.com/a/?utm_source=hn&utm_medium=feed&fbclid=x&ref=feed#section');
    expect(normalized.startsWith('https://example.com/')).toBe(true);
    expect(normalized.includes('utm_source')).toBe(false);
    expect(normalized.includes('fbclid')).toBe(false);
    expect(normalized.includes('ref=')).toBe(false);
    expect(normalized.includes('#')).toBe(false);
    expect(normalizeUrl(normalized)).toBe(normalized);
  });

  it('相同标题判为相似，无关标题不相似', () => {
    expect(isSimilarTitle('OpenAI 发布 GPT-5', 'OpenAI 发布 GPT-5')).toBe(true);
    expect(isSimilarTitle('OpenAI 发布 GPT-5', '今日天气：上海多云转晴')).toBe(false);
  });
});

describe('news-errors：截断与脱敏', () => {
  it('超长文本被截断，不保留原长度', () => {
    const long = 'x'.repeat(5000);
    expect(truncateMessage(long).length).toBeLessThan(2100);
  });

  it('普通文案原样返回，连接串中的口令被脱敏', () => {
    expect(sanitizeMessage('boom')).toBe('boom');
    const sanitized = sanitizeMessage('postgres://user:s3cr3tPassw0rd@db:5432/news');
    expect(typeof sanitized).toBe('string');
    expect(sanitized.includes('s3cr3tPassw0rd')).toBe(false);
  });
});
