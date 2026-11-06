import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TITLE_SIMILARITY_THRESHOLD,
  isSimilarTitle,
  normalizeTitle,
  normalizeUrl,
  titleFingerprint,
  titleSimilarity,
} from '../src/lib/normalize';

test('normalizeUrl 去追踪参数、按键排序查询、去尾斜杠', () => {
  assert.equal(
    normalizeUrl('https://example.com/a/?b=2&a=1&utm_source=hn#frag'),
    'https://example.com/a?a=1&b=2',
  );
  assert.equal(normalizeUrl('https://example.com'), 'https://example.com/');
  assert.equal(normalizeUrl('HTTPS://Example.com:443/A/'), 'https://example.com/A');
});

test('normalizeUrl 仅接受 http(s)，其余协议与非法输入返回空串', () => {
  assert.equal(normalizeUrl('ftp://example.com/a'), '');
  assert.equal(normalizeUrl('javascript:alert(1)'), '');
  assert.equal(normalizeUrl('not a url'), '');
  assert.equal(normalizeUrl('   '), '');
});

test('normalizeTitle 只保留字母数字并把标点归一为空格', () => {
  assert.equal(normalizeTitle('OpenAI 发布 GPT-5！'), 'openai 发布 gpt 5');
  assert.equal(titleSimilarity('OpenAI 发布 GPT-5', 'OpenAI 发布 GPT 5!'), 1);
});

test('标题相似度大于阈值判为重复，否则不判重', () => {
  assert.equal(TITLE_SIMILARITY_THRESHOLD, 0.9);
  assert.ok(titleSimilarity('OpenAI releases GPT-5 model', 'OpenAI releases GPT-5 models') > 0.9);
  assert.equal(isSimilarTitle('OpenAI releases GPT-5 model', 'OpenAI releases GPT-5 models'), true);
  assert.equal(isSimilarTitle('OpenAI releases GPT-5 model', 'Roblox 服务器大面积宕机'), false);
  assert.equal(titleSimilarity('', 'anything'), 0);
});

test('titleFingerprint 稳定且对同一归一化标题一致', () => {
  assert.equal(titleFingerprint('OpenAI 发布 GPT-5'), titleFingerprint('openai 发布 GPT 5!'));
  assert.match(titleFingerprint('OpenAI 发布 GPT-5'), /^[0-9a-f]{8}$/);
});
