import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TITLE_SIMILARITY_THRESHOLD,
  isDuplicateOf,
  isSimilarTitle,
  normalizeTitle,
  normalizeUrl,
  titleFingerprint,
  titleSimilarity,
} from '../src/app/news-dedup';

test('normalizeUrl：去掉尾斜杠并保留排序后的查询串', () => {
  assert.equal(normalizeUrl('https://example.com/a/?a=1&b=2'), 'https://example.com/a?a=1&b=2');
  assert.equal(
    normalizeUrl('https://Example.com/news/?utm_source=hn&b=2&a=1#frag'),
    'https://example.com/news?a=1&b=2',
  );
});

test('normalizeUrl：空值与非法输入保持稳定且不抛错', () => {
  assert.equal(normalizeUrl(''), '');
  assert.equal(normalizeUrl('   '), '');
  assert.equal(normalizeUrl('not a url'), 'not a url');
});

test('normalizeTitle：仅标点与大小写差异视为同一标题', () => {
  assert.equal(normalizeTitle('Hello, World!'), normalizeTitle('hello world'));
  assert.equal(titleSimilarity('Hello, World!', 'hello world'), 1);
});

test('titleFingerprint：归一化后相同则指纹相同，不同标题指纹不同', () => {
  assert.equal(titleFingerprint('AI 模型发布'), titleFingerprint('ai 模型发布!'));
  assert.notEqual(titleFingerprint('alpha beta'), titleFingerprint('gamma delta'));
});

test('titleSimilarity：轻微改写 > 0.9，无关标题 < 0.9', () => {
  const similar = titleSimilarity('OpenAI releases GPT-5 model', 'OpenAI releases GPT-5 models');
  assert.ok(similar > TITLE_SIMILARITY_THRESHOLD, `similar=${similar}`);
  assert.ok(isSimilarTitle('OpenAI releases GPT-5 model', 'OpenAI releases GPT-5 models'));
  assert.ok(!isSimilarTitle('OpenAI releases GPT-5 model', 'Rust 1.90 released with new borrow checker'));
});

test('isDuplicateOf：同 URL 或高相似标题判为重复', () => {
  assert.equal(
    isDuplicateOf(
      { url: 'https://example.com/a', title: 'OpenAI releases GPT-5 model' },
      { url: 'https://example.com/a/?utm_source=twitter', title: '完全不同的一段标题' },
    ),
    true,
  );
  assert.equal(
    isDuplicateOf(
      { url: 'https://example.com/a', title: 'OpenAI releases GPT-5 model' },
      { url: 'https://example.com/b', title: 'Totally unrelated words here' },
    ),
    false,
  );
});
