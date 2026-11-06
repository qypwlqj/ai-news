import { describe, expect, it } from 'vitest';
import { isDuplicateNews, normalizeUrl, titleFingerprint, titleSimilarity } from '../src/lib/dedup';

describe('normalizeUrl', () => {
  it('drops tracking params, hash and trailing slash, sorts params', () => {
    expect(normalizeUrl('http://Example.com/a/?utm_source=x&b=2&a=1#top')).toBe(
      'https://example.com/a?a=1&b=2',
    );
  });

  it('keeps path case and root slash', () => {
    expect(normalizeUrl('https://Example.com/Path/')).toBe('https://example.com/Path');
    expect(normalizeUrl('https://Example.com/')).toBe('https://example.com/');
  });
});

describe('titleFingerprint / titleSimilarity', () => {
  it('normalizes case, full-width chars, punctuation and spaces', () => {
    expect(titleFingerprint('ＡＩ 模型，发布！')).toBe('ai模型发布');
    expect(titleSimilarity('OpenAI 发布 GPT-5 模型', 'openai 发布 gpt-5 模型')).toBe(1);
  });

  it('treats > 0.9 similarity as duplicate and lower similarity as distinct', () => {
    expect(titleSimilarity('OpenAI releases GPT-5 model', 'OpenAI releases GPT-5 models')).toBeGreaterThan(0.9);
    expect(titleSimilarity('OpenAI releases GPT-5 model', '开源模型推理优化实践')).toBeLessThan(0.5);
  });

  it('dedups by normalized url or similar title', () => {
    expect(isDuplicateNews({ url: 'https://a.test/x', title: 'A' }, { url: 'http://a.test/x/?utm_source=z', title: 'B' })).toBe(true);
    expect(
      isDuplicateNews(
        { url: 'https://a.test/x', title: 'OpenAI releases GPT-5 model' },
        { url: 'https://b.test/y', title: 'OpenAI releases GPT-5 models' },
      ),
    ).toBe(true);
    expect(isDuplicateNews({ url: 'https://a.test/x', title: '模型发布' }, { url: 'https://b.test/y', title: '政策融资' })).toBe(false);
  });
});
