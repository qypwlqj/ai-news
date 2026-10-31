import { describe, expect, it } from 'vitest';

import { ERROR_MESSAGE_MAX_CHARS } from '../src/app/news-constants';
import {
  apiErrorBody,
  createRequestId,
  redactSensitive,
  sanitizeMessage,
  truncateMessage,
} from '../src/app/news-errors';

describe('news-errors', () => {
  it('脱敏 Bearer 令牌与数据库连接串', () => {
    const input = 'Authorization: Bearer abc.def-123, db=postgresql://u:p@host:5432/news';
    const out = redactSensitive(input);
    expect(out).not.toContain('abc.def-123');
    expect(out).not.toContain('u:p@host');
    expect(out).toContain('Bearer [REDACTED]');
    expect(out).toContain('[REDACTED_URL]');
  });

  it('脱敏 secret 类键值', () => {
    const out = redactSensitive('CRON_SECRET=s3cr3t-value next');
    expect(out).not.toContain('s3cr3t-value');
    expect(out).toContain('[REDACTED_ENV]');
  });

  it('超长文案截断到 2000 字以内', () => {
    const long = 'a'.repeat(ERROR_MESSAGE_MAX_CHARS + 50);
    const out = truncateMessage(long);
    expect(out.length).toBe(ERROR_MESSAGE_MAX_CHARS);
    expect(out.endsWith('…')).toBe(true);
    expect(truncateMessage('boom')).toBe('boom');
  });

  it('空白归一并兼容 Error 与未知输入', () => {
    expect(sanitizeMessage('  source \n failed  ')).toBe('source failed');
    expect(sanitizeMessage(new Error('network down'))).toBe('network down');
    expect(typeof sanitizeMessage(undefined)).toBe('string');
  });

  it('错误信封字段齐全且 message 已脱敏', () => {
    expect(apiErrorBody('INVALID_DATE', 'date must be YYYY-MM-DD', 'req_1')).toEqual({
      error: { code: 'INVALID_DATE', message: 'date must be YYYY-MM-DD', requestId: 'req_1' },
    });
    const body = apiErrorBody('INTERNAL_ERROR', 'Bearer abc.def', 'req_2');
    expect(body.error.message).not.toContain('abc.def');
  });

  it('requestId 可注入随机源、格式稳定', () => {
    const id = createRequestId(() => 0.5);
    expect(id).toBe(createRequestId(() => 0.5));
    expect(id.startsWith('req_')).toBe(true);
    expect(id).toHaveLength(20);
  });
});
