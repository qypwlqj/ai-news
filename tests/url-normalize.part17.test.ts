import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeUrl } from '../src/app/url-normalize';

test('去掉尾斜杠并按键排序查询参数', () => {
  assert.equal(normalizeUrl('https://example.com/a/?a=1&b=2'), 'https://example.com/a?a=1&b=2');
  assert.equal(normalizeUrl('https://example.com/a?b=2&a=1'), 'https://example.com/a?a=1&b=2');
});

test('根路径保留斜杠且主机小写', () => {
  assert.equal(normalizeUrl('https://example.com'), 'https://example.com/');
  assert.equal(normalizeUrl('HTTPS://Example.COM/'), 'https://example.com/');
});

test('非 http(s) 协议与非法地址降级为空串而不抛错', () => {
  assert.equal(normalizeUrl('ftp://example.com/a'), '');
  assert.equal(normalizeUrl('javascript:alert(1)'), '');
  assert.equal(normalizeUrl('not a url'), '');
  assert.equal(normalizeUrl(''), '');
});

test('丢弃追踪参数与 fragment，并去默认端口', () => {
  assert.equal(
    normalizeUrl('https://example.com/a?utm_source=x&fbclid=y&ref=z&id=7#frag'),
    'https://example.com/a?id=7',
  );
  assert.equal(normalizeUrl('https://example.com:443/a'), 'https://example.com/a');
  assert.equal(normalizeUrl('http://example.com:8080/a/'), 'http://example.com:8080/a');
});
