import { describe, expect, it } from 'vitest';

import { normalizeUrl } from '../src/app/url-normalize';

describe('normalizeUrl 契约（docs/news-primitives.md）', () => {
  it('非根路径去尾斜杠并按键排序查询参数', () => {
    expect(normalizeUrl('https://example.com/a/?a=1&b=2')).toBe('https://example.com/a?a=1&b=2');
  });

  it('根路径保留斜杠', () => {
    expect(normalizeUrl('https://example.com')).toBe('https://example.com/');
  });

  it('非 http(s) 协议与非法地址返回空串而不抛错', () => {
    expect(normalizeUrl('ftp://example.com/a')).toBe('');
    expect(normalizeUrl('not a url')).toBe('');
    expect(normalizeUrl('')).toBe('');
  });

  it('丢弃追踪参数与 fragment，协议与主机小写', () => {
    expect(normalizeUrl('HTTPS://Example.com/Path/?utm_source=x&b=2&a=1&fbclid=y#frag')).toBe(
      'https://example.com/Path?a=1&b=2',
    );
  });

  it('去除默认端口、保留自定义端口', () => {
    expect(normalizeUrl('https://example.com:443/a')).toBe('https://example.com/a');
    expect(normalizeUrl('https://example.com:8443/a')).toBe('https://example.com:8443/a');
  });

  it('同名查询参数按值排序', () => {
    expect(normalizeUrl('https://example.com/a?tag=b&tag=a')).toBe(
      'https://example.com/a?tag=a&tag=b',
    );
  });
});
