import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCategoryHref,
  buildListHref,
  buildPaginationView,
  normalizeListQuery,
  resolveListCategory,
  resolveListDate,
  resolveListPage,
  sortNewsItemsForDisplay,
} from '../src/app/news-list-view';
import {
  SUMMARY_FAILED_TEXT,
  SUMMARY_PENDING_TEXT,
  SUMMARY_UNAVAILABLE_TEXT,
  renderSummaryBlock,
  resolveSummaryState,
} from '../src/components/SummaryBlock';
import {
  renderStateBlock,
  sanitizeActionHref,
  sanitizeRequestId,
  sanitizeStateMessage,
} from '../src/components/StateBlock';

test('列表 URL 参数：非法分类/日期/页码静默回退默认值', () => {
  assert.equal(resolveListCategory('research_paper'), 'research_paper');
  assert.equal(resolveListCategory(' RESEARCH_PAPER '), 'research_paper');
  assert.equal(resolveListCategory('constructor'), null);
  assert.equal(resolveListCategory('__proto__'), null);
  assert.equal(resolveListCategory('unknown'), null);
  assert.equal(resolveListDate('2025-06-01'), '2025-06-01');
  assert.equal(resolveListDate('2025-02-30'), null);
  assert.equal(resolveListDate('2025-6-1'), null);
  assert.equal(resolveListPage('3'), 3);
  assert.equal(resolveListPage('0'), 1);
  assert.equal(resolveListPage('-2'), 1);
  assert.equal(resolveListPage('abc'), 1);
  assert.deepEqual(normalizeListQuery({ category: 'nope', date: 'x', page: '2' }), {
    category: null,
    date: null,
    page: 2,
  });
});

test('列表链接：切换分类重置 page=1 并保留 date', () => {
  assert.equal(buildListHref(), '/');
  assert.equal(buildListHref({ page: 1 }), '/');
  assert.equal(buildListHref({ category: 'industry_news', page: 3 }), '/?category=industry_news&page=3');
  assert.equal(
    buildCategoryHref({ category: 'industry_news', date: '2025-06-01', page: 4 }, 'model_release'),
    '/?category=model_release&date=2025-06-01',
  );
  assert.equal(buildCategoryHref({ category: 'industry_news' }, null), '/');
});

test('列表按 publishedAt DESC, id DESC 排序，非法时间置后且稳定', () => {
  const items = [
    { id: 'a', publishedAt: '2025-06-01T00:00:00.000Z' },
    { id: 'c', publishedAt: 'not-a-date' },
    { id: 'b', publishedAt: '2025-06-02T00:00:00.000Z' },
    { id: 'a2', publishedAt: '2025-06-01T00:00:00.000Z' },
  ];
  assert.deepEqual(
    sortNewsItemsForDisplay(items).map((item) => item.id),
    ['b', 'a2', 'a', 'c'],
  );
});

test('分页视图：共 N 条、空集 totalPages=1、页码窗口与链接', () => {
  const view = buildPaginationView({ page: 2, total: 45, limit: 20 });
  assert.equal(view.totalLabel, '共 45 条');
  assert.equal(view.totalPages, 3);
  assert.deepEqual(view.pageNumbers, [1, 2, 3]);
  assert.equal(view.prevHref, '/');
  assert.equal(view.nextHref, '/?page=3');

  const empty = buildPaginationView({ total: 0 });
  assert.equal(empty.totalLabel, '共 0 条');
  assert.equal(empty.totalPages, 1);
  assert.equal(empty.prevHref, null);
  assert.equal(empty.nextHref, null);

  const clamped = buildPaginationView({ page: 9, total: 200, limit: 20, query: { category: 'industry_news' } });
  assert.equal(clamped.page, 10);
  assert.equal(clamped.nextHref, null);
  assert.equal(clamped.prevHref, '/?category=industry_news&page=9');
  assert.deepEqual(clamped.pageNumbers, [1, 'gap', 9, 10]);
});

test('摘要三态：ok/pending/failed 与未知状态兜底', () => {
  assert.equal(resolveSummaryState('ok', '摘要'), 'ok');
  assert.equal(resolveSummaryState('ok', '   '), 'failed');
  assert.equal(resolveSummaryState('pending', null), 'pending');
  assert.equal(resolveSummaryState('failed', '旧摘要'), 'failed');
  assert.equal(resolveSummaryState('weird', '原文摘要'), 'unknown');

  const ok = renderSummaryBlock({ summary: '<b>模型</b> 发布', summaryStatus: 'ok' });
  assert.match(ok, /data-summary-state="ok"/);
  assert.ok(ok.includes('&lt;b&gt;模型&lt;/b&gt; 发布'));
  assert.ok(!ok.includes('<b>'));

  const pending = renderSummaryBlock({ summary: null, summaryStatus: 'pending' });
  assert.ok(pending.includes(SUMMARY_PENDING_TEXT));
  assert.match(pending, /aria-busy="true"/);

  const failed = renderSummaryBlock({ summary: null, summaryStatus: 'failed' });
  assert.ok(failed.includes(SUMMARY_FAILED_TEXT));

  const unknown = renderSummaryBlock({ summary: '原文摘要', summaryStatus: 'weird' });
  assert.ok(unknown.includes('原文摘要'));
  assert.match(unknown, /data-summary-state="unknown"/);

  const unknownEmpty = renderSummaryBlock({ summary: null, summaryStatus: 'weird' });
  assert.ok(unknownEmpty.includes(SUMMARY_UNAVAILABLE_TEXT));
});

test('摘要超长按码点截断到 200', () => {
  const long = `${'智'.repeat(250)}${'🤖'.repeat(20)}`;
  const html = renderSummaryBlock({ summary: long, summaryStatus: 'ok' });
  const text = html.replace(/^<p[^>]*>/, '').replace(/<\/p>$/, '');
  assert.equal(Array.from(text).length, 200);
});

test('StateBlock：空态/不存在态文案与错误脱敏', () => {
  const empty = renderStateBlock({ type: 'empty' });
  assert.match(empty, /data-state="empty"/);
  assert.match(empty, /role="status"/);
  assert.ok(empty.includes('今日暂无资讯'));

  const notfound = renderStateBlock({ type: 'notfound' });
  assert.ok(notfound.includes('资讯不存在或已下线'));

  const message = sanitizeStateMessage('连接 postgres://user:pw@db:5432/news 失败 token=abc123\n请重试');
  assert.ok(message.includes('[已脱敏]'));
  assert.ok(!message.includes('postgres://'));
  assert.ok(!message.includes('abc123'));
  assert.ok(!message.includes('\n'));

  const error = renderStateBlock({ type: 'error', message, requestId: 'req_123' });
  assert.match(error, /role="alert"/);
  assert.ok(error.includes('requestId: req_123'));
  assert.ok(!error.includes('postgres://'));
});

test('StateBlock：requestId 与操作链接只接受安全值', () => {
  assert.equal(sanitizeRequestId('req_123'), 'req_123');
  assert.equal(sanitizeRequestId('<script>'), null);
  assert.equal(sanitizeRequestId('a'.repeat(65)), null);
  assert.equal(sanitizeActionHref('/'), '/');
  assert.equal(sanitizeActionHref('/news/1'), '/news/1');
  assert.equal(sanitizeActionHref('javascript:alert(1)'), null);
  assert.equal(sanitizeActionHref('//evil.example.com'), null);

  const unsafe = renderStateBlock({
    type: 'error',
    requestId: 'x"><b>',
    actionLabel: '重试',
    actionHref: 'javascript:alert(1)',
  });
  assert.ok(!unsafe.includes('javascript:'));
  assert.ok(!unsafe.includes('"><b>'));

  const safe = renderStateBlock({ type: 'error', actionLabel: '重试', actionHref: '/?page=1' });
  assert.ok(safe.includes('href="/?page=1"'));
});
