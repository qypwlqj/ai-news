import { describe, expect, it } from 'vitest';

import { TITLE_SIMILARITY_THRESHOLD } from '../src/app/news-constants';
import {
  isDuplicateOf,
  isSimilarTitle,
  normalizeTitle,
  normalizeUrl,
  titleFingerprint,
  titleSimilarity,
} from '../src/app/news-dedup';

describe('normalizeUrl 硬去重键', () => {
  it('去追踪参数与 fragment、去尾斜杠、主机小写', () => {
    expect(normalizeUrl('HTTPS://Example.COM/Path/?utm_source=x&fbclid=y&id=7#frag')).toBe(
      'https://example.com/Path?id=7',
    );
  });

  it('查询参数按键排序，等价 URL 归一化结果一致', () => {
    expect(normalizeUrl('https://example.com/a?b=2&a=1')).toBe(
      normalizeUrl('https://example.com/a?a=1&b=2'),
    );
  });

  it('根路径保留 /', () => {
    expect(normalizeUrl('https://example.com')).toBe('https://example.com/');
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('空串与非 http(s) 返回空串', () => {
    expect(normalizeUrl('')).toBe('');
    expect(normalizeUrl('   ')).toBe('');
    expect(normalizeUrl('ftp://example.com/a')).toBe('');
    expect(normalizeUrl('not a url')).toBe('');
  });
});

describe('normalizeTitle / titleFingerprint', () => {
  it('NFKC + 小写 + 去标点与空白归一', () => {
    expect(normalizeTitle('  OpenAI 发布 GPT-5！ ')).toBe('openai 发布 gpt 5');
  });

  it('指纹为 8 位十六进制且对大小写/标点差异稳定', () => {
    const fingerprint = titleFingerprint('OpenAI 发布 GPT-5');
    expect(fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(titleFingerprint('openai 发布 gpt 5')).toBe(fingerprint);
    expect(titleFingerprint('完全不同的一条资讯')).not.toBe(fingerprint);
  });
});

describe('titleSimilarity / isSimilarTitle', () => {
  it('完全一致为 1，空标题不视为重复', () => {
    expect(titleSimilarity('OpenAI 发布 GPT-5', 'openai 发布 gpt 5')).toBe(1);
    expect(titleSimilarity('', '')).toBe(0);
  });

  it('近似标题 > 0.9，无关标题 < 0.9', () => {
    const near = titleSimilarity(
      'arxiv cs ai 2025 paper on diffusion models',
      'arxiv cs ai 2025 paper on diffusion model',
    );
    expect(near).toBeGreaterThan(TITLE_SIMILARITY_THRESHOLD);
    expect(
      titleSimilarity('OpenAI releases GPT-5', 'arXiv 论文提出新的扩散模型'),
    ).toBeLessThan(TITLE_SIMILARITY_THRESHOLD);
    expect(
      isSimilarTitle(
        'OpenAI releases GPT-5 with better reasoning',
        'OpenAI releases GPT-5 with better reasoning.',
      ),
    ).toBe(true);
    expect(isSimilarTitle('OpenAI releases GPT-5', 'arXiv 论文提出新的扩散模型')).toBe(false);
  });
});

describe('isDuplicateOf 双策略判重', () => {
  it('同 URL 不同追踪参数判为重复', () => {
    expect(
      isDuplicateOf(
        { url: 'https://example.com/a?utm_source=x', title: '标题 A' },
        { url: 'https://example.com/a', title: '标题 B' },
      ),
    ).toBe(true);
  });

  it('不同 URL 但标题相似度 > 0.9 判为重复', () => {
    expect(
      isDuplicateOf(
        { url: 'https://example.com/a', title: 'OpenAI releases GPT-5 with better reasoning' },
        { url: 'https://other.com/b', title: 'OpenAI releases GPT-5 with better reasoning!' },
      ),
    ).toBe(true);
  });

  it('URL 与标题都不同判为不重复', () => {
    expect(
      isDuplicateOf(
        { url: 'https://example.com/a', title: 'OpenAI releases GPT-5' },
        { url: 'https://other.com/b', title: 'arXiv 论文提出新的扩散模型' },
      ),
    ).toBe(false);
  });
});
