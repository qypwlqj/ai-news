/**
 * 统一错误信封与脱敏截断：
 * 所有非 2xx 响应形如 { error: { code, message, requestId } }，code 为稳定机器码常量；
 * message 仅用于展示，写入日志/响应前必须脱敏并截断，严禁出现令牌、连接串或环境变量值。
 */

import { ERROR_MESSAGE_MAX_CHARS } from './news-constants';

export interface ApiErrorBody {
  error: { code: string; message: string; requestId: string };
}

/** 先连接串、再 Bearer 令牌、最后 secret 类 key=value，顺序不可颠倒。 */
const REDACTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/postgres(?:ql)?:\/\/[^\s"']+/gi, '[REDACTED_URL]'],
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]'],
  [
    /[A-Za-z_]*(?:secret|token|password|passwd|api[_-]?key)[A-Za-z_]*\s*[=:]\s*[^\s,;"']+/gi,
    '[REDACTED_ENV]',
  ],
];

/** 脱敏：去掉连接串、Bearer 令牌与 secret 类键值，保留其余可读文案。 */
export function redactSensitive(input: string): string {
  let out = input;
  for (const [pattern, replacement] of REDACTIONS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/** 截断到上限（默认 2000 字），超出部分以省略号收尾，结果长度恒 ≤ 上限。 */
export function truncateMessage(input: string, max: number = ERROR_MESSAGE_MAX_CHARS): string {
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : ERROR_MESSAGE_MAX_CHARS;
  return input.length <= limit ? input : `${input.slice(0, limit - 1)}…`;
}

/** 出参/落库前的统一处理：转字符串 → 空白归一 → 脱敏 → 截断，绝不回显堆栈细节。 */
export function sanitizeMessage(input: unknown, max: number = ERROR_MESSAGE_MAX_CHARS): string {
  const raw = typeof input === 'string' ? input : input instanceof Error ? input.message : String(input ?? '');
  return truncateMessage(redactSensitive(raw.replace(/\s+/g, ' ').trim()), max);
}

/** 生成排障用的 requestId（不读环境变量、不依赖外部服务，随机源可注入）。 */
export function createRequestId(random: () => number = Math.random): string {
  const part = () => Math.floor(random() * 0x1_0000_0000).toString(16).padStart(8, '0');
  return `req_${part()}${part()}`;
}

/** 构造统一错误信封；message 一律经 sanitizeMessage（脱敏 + 截断）。 */
export function apiErrorBody(code: string, message: unknown, requestId: string): ApiErrorBody {
  return { error: { code, message: sanitizeMessage(message), requestId } };
}
