import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  TITLE_SIMILARITY_THRESHOLD,
  isSimilarTitle,
  normalizeTitle,
  normalizeUrl,
  titleFingerprint,
  titleSimilarity,
} from '../src/lib/normalize';
import {
  UNKNOWN_CATEGORY_LABEL,
  UNKNOWN_SOURCE_LABEL,
  UNKNOWN_SUMMARY_STATUS_LABEL,
  categoryLabel,
  categoryOptions,
  categoryOrder,
  sourceLabel,
  summaryStatusLabel,
} from '../src/lib/labels';
import { API_ERROR_CODES, CATEGORIES, isRunStatus, isSummaryStatus } from '../src/lib/types';

describe('normalizeUrl', () => {
  it('去掉追踪参数、片段与尾斜杠，主机小写并排序查询参数', () => {
    assert.equal(
      normalizeUrl('HTTPS://Example.COM/Post/?utm_source=x&b=2&a=1#comments'),
      'https://example.com/Post?a=1&b=2',
    );
  });

  it('默认端口归一，保留路径大小写', () => {
    assert.equal(normalizeUrl('http://Example.com:80/A/'), 'http://example.com/A');
  });

  it('空值与非法 URL 降级而不抛错', () => {
    assert.equal(normalizeUrl('   '), '');
    assert.equal(normalizeUrl('not a url'), 'not a url');
  });

  it('非 http(s) 协议原样返回', () => {
    assert.equal(normalizeUrl('ftp://example.com/a'), 'ftp://example.com/a');
  });
});

describe('标题指纹与相似度', () => {
  it('大小写、标点与全半角差异归一后指纹相同', () => {
    assert.equal(titleFingerprint('OpenAI 发布 GPT-5 模型！'), titleFingerprint('openai 发布 gpt-5 模型'));
  });

  it('NFKC 统一全半角', () => {
    assert.equal(normalizeTitle('ＡＩ 资讯'), 'ai 资讯');
  });

  it('完全相同标题相似度为 1', () => {
    assert.equal(titleSimilarity('AI 周报', 'ai 周报!'), 1);
  });

  it('近似标题相似度大于阈值并判为重复', () => {
    assert.ok(
      titleSimilarity('Hacker News: AI roundup', 'Hacker News: AI roundup 2025') > TITLE_SIMILARITY_THRESHOLD,
    );
    assert.equal(isSimilarTitle('Hacker News: AI roundup', 'Hacker News: AI roundup 2025'), true);
  });

  it('不同标题不判重，空值边界可控', () => {
    assert.equal(isSimilarTitle('OpenAI 发布新模型', '监管机构发布 AI 法案草案'), false);
    assert.equal(titleSimilarity('', ''), 1);
    assert.equal(titleSimilarity('仅一侧有标题', ''), 0);
  });
});

describe('文案字典', () => {
  it('5 个分类的 label 与 order 固定', () => {
    const options = categoryOptions();
    assert.equal(options.length, 5);
    assert.deepEqual(
      options.map((item) => item.value),
      CATEGORIES.map((item) => item.value),
    );
    assert.equal(categoryLabel('model_release'), '模型发布');
    assert.equal(categoryLabel('policy_funding'), '政策融资');
    assert.equal(categoryOrder('policy_funding'), 5);
  });

  it('未知值降级为原值文本而不报错', () => {
    assert.equal(categoryLabel('other'), 'other');
    assert.equal(categoryLabel(null), UNKNOWN_CATEGORY_LABEL);
    assert.equal(categoryOrder('other'), Number.MAX_SAFE_INTEGER);
    assert.equal(sourceLabel('weibo'), 'weibo');
    assert.equal(sourceLabel(null), UNKNOWN_SOURCE_LABEL);
  });

  it('来源与摘要状态文案', () => {
    assert.equal(sourceLabel('hacker_news'), 'Hacker News');
    assert.equal(sourceLabel('arxiv_cs_ai'), 'ArXiv cs.AI');
    assert.equal(sourceLabel('jiqizhixin'), '机器之心');
    assert.equal(summaryStatusLabel('ok'), null);
    assert.equal(summaryStatusLabel('failed'), '摘要生成失败');
    assert.equal(summaryStatusLabel('pending'), '摘要生成中');
    assert.equal(summaryStatusLabel('unknown'), UNKNOWN_SUMMARY_STATUS_LABEL);
  });
});

describe('枚举与错误码冻结', () => {
  it('分类与状态集合固定', () => {
    assert.equal(CATEGORIES.length, 5);
    assert.equal(isSummaryStatus('failed'), true);
    assert.equal(isSummaryStatus('bad'), false);
    assert.equal(isRunStatus('partial_failure'), true);
    assert.equal(isRunStatus('skipped'), false);
  });

  it('错误码包含契约必需项', () => {
    const codes: readonly string[] = API_ERROR_CODES;
    for (const code of [
      'INVALID_DATE',
      'INVALID_CATEGORY',
      'INVALID_SOURCE',
      'INVALID_PAGINATION',
      'NEWS_NOT_FOUND',
      'COLLECT_IN_PROGRESS',
      'ALL_SOURCES_FAILED',
      'INTERNAL_ERROR',
    ]) {
      assert.ok(codes.includes(code), code);
    }
  });
});
