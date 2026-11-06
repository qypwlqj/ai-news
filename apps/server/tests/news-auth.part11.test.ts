import { describe, expect, it } from 'vitest';

import { extractBearerToken, timingSafeEqual, verifyCronAuth } from '../src/app/news-auth';

describe('extractBearerToken', () => {
  it('解析标准 Bearer 头', () => {
    expect(extractBearerToken('Bearer token-value')).toBe('token-value');
  });

  it('scheme 大小写不敏感并容忍首尾空白', () => {
    expect(extractBearerToken('  bearer   token-value  ')).toBe('token-value');
  });

  it('缺失或格式错误返回 null', () => {
    expect(extractBearerToken(null)).toBeNull();
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken('')).toBeNull();
    expect(extractBearerToken('token-value')).toBeNull();
    expect(extractBearerToken('Basic token-value')).toBeNull();
    expect(extractBearerToken('Bearer ')).toBeNull();
    expect(extractBearerToken(`Bearer ${'x'.repeat(5000)}`)).toBeNull();
  });
});

describe('verifyCronAuth', () => {
  it('令牌匹配通过', () => {
    expect(verifyCronAuth('Bearer expected-value', 'expected-value')).toEqual({ ok: true });
  });

  it('缺失或非 Bearer 头返回 401 UNAUTHORIZED', () => {
    expect(verifyCronAuth(null, 'expected-value')).toEqual({
      ok: false,
      status: 401,
      code: 'UNAUTHORIZED',
    });
    expect(verifyCronAuth('', 'expected-value')).toEqual({
      ok: false,
      status: 401,
      code: 'UNAUTHORIZED',
    });
    expect(verifyCronAuth('Token expected-value', 'expected-value')).toEqual({
      ok: false,
      status: 401,
      code: 'UNAUTHORIZED',
    });
  });

  it('令牌不匹配返回 403 FORBIDDEN', () => {
    expect(verifyCronAuth('Bearer wrong-value', 'expected-value')).toEqual({
      ok: false,
      status: 403,
      code: 'FORBIDDEN',
    });
  });

  it('服务端未配置令牌时不接受任何请求', () => {
    for (const expected of [null, undefined, '', '   ']) {
      expect(verifyCronAuth('Bearer anything', expected)).toEqual({
        ok: false,
        status: 403,
        code: 'FORBIDDEN',
      });
    }
  });

  it('校验结果不包含令牌明文', () => {
    const result = verifyCronAuth('Bearer wrong-value', 'expected-value');
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('expected-value');
    expect(serialized).not.toContain('wrong-value');
  });
});

describe('timingSafeEqual', () => {
  it('等值判定', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('', '')).toBe(true);
  });

  it('长度或内容不同判为不等', () => {
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', '')).toBe(false);
  });
});
