/**
 * 时间语义：date=YYYY-MM-DD 按 Asia/Shanghai 自然日解释，换算为 UTC 半开区间
 * [startUtc, endUtc)；非法日期直接抛错/由接口层映射 400 INVALID_DATE，不静默纠正。
 */

import { DAY_MS, SHANGHAI_OFFSET_MINUTES } from './news-constants';

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 严格校验 YYYY-MM-DD（含真实日历校验，拒绝 2025-02-30）。 */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const matched = ISO_DATE_PATTERN.exec(value);
  if (!matched) return false;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const utc = new Date(Date.UTC(year, month - 1, day));
  return (
    utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day
  );
}

export interface UtcRange {
  startUtc: Date;
  endUtc: Date;
}

/** 上海自然日 → UTC 半开区间（上海固定 +08:00，区间恒为 24h）。 */
export function shanghaiDayRangeUtc(date: string): UtcRange {
  if (!isIsoDate(date)) throw new RangeError('date must be a valid YYYY-MM-DD');
  const startMs = Date.parse(`${date}T00:00:00.000+08:00`);
  if (!Number.isFinite(startMs)) throw new RangeError('date must be a valid YYYY-MM-DD');
  return { startUtc: new Date(startMs), endUtc: new Date(startMs + DAY_MS) };
}

/** 任意时刻 → 上海自然日字符串（YYYY-MM-DD）。 */
export function toShanghaiDateString(input: Date | number = Date.now()): string {
  const ms = typeof input === 'number' ? input : input.getTime();
  if (!Number.isFinite(ms)) throw new RangeError('invalid timestamp');
  return new Date(ms + SHANGHAI_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);
}

/** 缺省 date：当前上海自然日。 */
export function shanghaiToday(now: Date = new Date()): string {
  return toShanghaiDateString(now);
}
