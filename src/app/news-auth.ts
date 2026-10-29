/**
 * 外部调度鉴权：`POST /api/cron/collect` 的 Bearer 令牌校验。
 *
 * 约定（见 docs/api.md）：
 * - 令牌值由调用方传入（生产从环境变量读取），本模块不读环境变量、不建连接、不发网络请求；
 * - 缺失或格式错误的 `Authorization` 头 → `401 UNAUTHORIZED`；
 * - 令牌不匹配或服务端未配置令牌 → `403 FORBIDDEN`；
 * - 返回值为纯数据，绝不包含任何令牌明文。
 */

export type CronAuthFailureCode = 'UNAUTHORIZED' | 'FORBIDDEN';

export type CronAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 403; code: CronAuthFailureCode };

const BEARER_SCHEME = 'bearer';
const MAX_TOKEN_LENGTH = 4096;

/** 从 `Authorization` 头提取 Bearer 令牌；格式不符返回 null。 */
export function extractBearerToken(header: string | null | undefined): string | null {
  if (typeof header !== 'string') return null;
  const trimmed = header.trim();
  const separator = trimmed.indexOf(' ');
  if (separator <= 0) return null;
  if (trimmed.slice(0, separator).toLowerCase() !== BEARER_SCHEME) return null;
  const token = trimmed.slice(separator + 1).trim();
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
  return token;
}

/** 定长时间比较，避免按字符提前返回泄露长度或前缀信息。 */
export function timingSafeEqual(a: string, b: string): boolean {
  const left = typeof a === 'string' ? a : '';
  const right = typeof b === 'string' ? b : '';
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < length; i += 1) {
    diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/** 校验 `Authorization` 头与期望令牌；结果不含任何令牌明文。 */
export function verifyCronAuth(
  header: string | null | undefined,
  expectedToken: string | null | undefined,
): CronAuthResult {
  const token = extractBearerToken(header);
  if (token === null) return { ok: false, status: 401, code: 'UNAUTHORIZED' };
  const expected = typeof expectedToken === 'string' ? expectedToken.trim() : '';
  if (expected.length === 0) return { ok: false, status: 403, code: 'FORBIDDEN' };
  if (!timingSafeEqual(token, expected)) return { ok: false, status: 403, code: 'FORBIDDEN' };
  return { ok: true };
}
