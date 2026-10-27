import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categoryLabel, isSafeUrl, newsCardHtml, newsListHtml, sourceLabel } from '../src/components/NewsCard';
import { categoryChipsHtml, categoryOptions } from '../src/components/CategoryChips';
import { paginationHtml } from '../src/components/Pagination';
import { renderHomePage } from '../src/app/page';

const base = {
  id: 'n1',
  title: 'OpenAI 发布新模型',
  url: 'https://example.com/a?utm_source=x',
  source: 'hacker_news',
  publishedAt: '2025-06-01T00:00:00.000Z',
  summary: '这是摘要内容',
  category: 'model_release',
  summaryStatus: 'ok',
};

test('newsCardHtml 渲染来源徽标、外链与摘要', () => {
  const html = newsCardHtml(base);
  assert.match(html, /Hacker News/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /这是摘要内容/);
  assert.match(html, /模型发布/);
  assert.match(html, /\/news\/n1/);
});

test('summaryStatus=failed 条目仍可见可点并展示占位文案', () => {
  const html = newsCardHtml({ ...base, summary: null, summaryStatus: 'failed' });
  assert.match(html, /摘要生成失败/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /这是摘要内容/);
});

test('summaryStatus=pending 展示生成中文案', () => {
  assert.match(newsCardHtml({ ...base, summary: null, summaryStatus: 'pending' }), /摘要生成中/);
});

test('未知来源/分类降级为原值文本，非 http(s) 链接不跳转', () => {
  assert.equal(sourceLabel('unknown_src'), 'unknown_src');
  assert.equal(categoryLabel('other_category'), 'other_category');
  assert.equal(isSafeUrl('javascript:alert(1)'), false);
  assert.match(newsCardHtml({ ...base, url: 'javascript:alert(1)' }), /href="#"/);
});

test('newsListHtml 渲染 20 条并提供空态', () => {
  const items = Array.from({ length: 20 }, (_, index) => ({
    ...base,
    id: `n${index}`,
    title: `标题 ${index}`,
  }));
  const html = newsListHtml(items);
  assert.equal((html.match(/<li class="news-card/g) ?? []).length, 20);
  assert.match(newsListHtml([]), /该分类今日暂无资讯/);
});

test('分类 Chip 覆盖 5 类 + 全部，选中态同步并重置分页', () => {
  assert.equal(categoryOptions().length, 5);
  const html = categoryChipsHtml('research_paper', '2025-06-01');
  assert.match(html, /全部/);
  assert.match(html, /研究论文/);
  assert.match(html, /chip--active/);
  assert.match(html, /aria-selected="true"/);
  assert.doesNotMatch(html, /page=/);
});

test('分页控件 totalPages<=1 隐藏，翻页链接保留筛选条件', () => {
  assert.equal(paginationHtml({ page: 1, totalPages: 1, total: 5 }), '');
  const html = paginationHtml({ page: 2, totalPages: 3, total: 42, category: 'industry_news' });
  assert.match(html, /共 42 条/);
  assert.match(html, /rel="next"/);
  assert.match(html, /page=3/);
  assert.match(html, /上一页/);
});

test('renderHomePage 服务端直出完整文档与分类筛选栏', async () => {
  const html = await renderHomePage(new URLSearchParams({ category: 'model_release' }));
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /资讯分类/);
  assert.match(html, /ai-news/);
});
