import { describe, expect, it } from 'vitest';

import {
  TITLE_SIMILARITY_THRESHOLD,
  isSimilarTitle,
  normalizeTitle,
  normalizeUrl,
  titleFingerprint,
  titleSimilarity,
} from '../src/lib/normalize';

describe('normalizeUrl', () => {
  it('非根路径去尾斜杠并按键排序查询参数', () => {
    expect(normalizeUrl('https://example.com/a/?a=1&b=2')).toBe('https://example.com/a?a=1&b=2');
    expect(normalizeUrl('https://example.com/a?b=2&a=1')).toBe('https://example.com/a?a=1&b=2');
  });

  it('根路径保留斜杠，协议与主机小写', () => {
    expect(normalizeUrl('https://example.com')).toBe('https://example.com/');
    expect(normalizeUrl('HTTPS://Example.COM/')).toBe('https://example.com/');
  });

  it('非 http/https 或无法解析返回空串', () => {
    expect(normalizeUrl('ftp://example.com/a')).toBe('');
    expect(normalizeUrl('not-a-url')).toBe('');
    expect(normalizeUrl('')).toBe('');
  });

  it('丢弃追踪参数与 fragment', () => {
    expect(normalizeUrl('https://example.com/a/?utm_source=x&fbclid=y&id=7#top')).toBe(
      'https://example.com/a?id=7',
    );
  });
});

describe('normalizeTitle 与标题相似度', () => {
  it('仅标点与空白差异相似度为 1', () => {
    expect(normalizeTitle('OpenAI 发布 GPT-5！')).toBe('openai 发布 gpt 5');
    expect(titleSimilarity('OpenAI 发布 GPT-5！', 'openai 发布 gpt 5')).toBe(1);
  });

  it('轻微改写相似度大于阈值，无关标题小于阈值', () => {
    const rewritten = titleSimilarity('OpenAI releases GPT-5 model today', 'OpenAI released GPT-5 model today');
    expect(rewritten).toBeGreaterThan(TITLE_SIMILARITY_THRESHOLD);
    expect(rewritten).toBeLessThanOrEqual(1);

    const unrelated = titleSimilarity('OpenAI 发布新模型', '英国央行宣布加息');
    expect(unrelated).toBeLessThan(TITLE_SIMILARITY_THRESHOLD);
  });

  it('isSimilarTitle 使用严格大于阈值判定', () => {
    expect(isSimilarTitle('OpenAI releases GPT-5 model today', 'OpenAI released GPT-5 model today')).toBe(true);
    expect(isSimilarTitle('OpenAI 发布新模型', '英国央行宣布加息')).toBe(false);
  });
});

describe('titleFingerprint', () => {
  it('归一化后一致则指纹一致，且为 8 位十六进制', () => {
    const fingerprint = titleFingerprint('OpenAI 发布 GPT-5！');
    expect(fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(fingerprint).toBe(titleFingerprint('openai 发布 gpt 5'));
    expect(fingerprint).not.toBe(titleFingerprint('英国央行宣布加息'));
  });
});
