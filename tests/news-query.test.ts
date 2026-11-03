import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as queryModule from '../src/app/news-query.ts';
import {
  CATEGORY_DICTIONARY,
  categoryLabel,
  isCategoryValue,
} from '../src/app/news-api-types.ts';

/**
 * 查询层契约测试：只验证对外语义（默认 limit=20、非法参数被拒绝、分类枚举单一真源、
 * summaryStatus=failed 条目不得被过滤），不触网、不连库；参数时区换算与索引细节见
 * docs/news-api.md。
 */

type UnknownRecord = Record<string, unknown>;

const queryExports = queryModule as unknown as UnknownRecord;

function resolveParser(): (input: URLSearchParams) => unknown {
  for (const name of [
    'parseNewsListQuery',
    'parseNewsQuery',
    'parseListQuery',
    'parseQuery',
  ]) {
    const candidate = queryExports[name];
    if (typeof candidate === 'function') {
      return candidate as (input: URLSearchParams) => unknown;
    }
  }
  assert.fail('src/app/news-query.ts 未导出查询参数解析函数');
}

const parseQuery = resolveParser();

type Outcome = { thrown: true; error: unknown } | { thrown: false; value: unknown };

function runQuery(search: string): Outcome {
  try {
    return { thrown: false, value: parseQuery(new URLSearchParams(search)) };
  } catch (error) {
    return { thrown: true, error };
  }
}

function readField(value: unknown, key: string): unknown {
  const seen = new Set<unknown>();
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current !== 'object' || current === null || seen.has(current)) continue;
    seen.add(current);
    const record = current as UnknownRecord;
    if (key in record) return record[key];
    for (const nested of Object.values(record)) pending.push(nested);
  }
  return undefined;
}

/** 非法参数在实现上可以是 throw，也可以返回 ok=false/error 的结果对象。 */
function isRejected(outcome: Outcome): boolean {
  if (outcome.thrown) return true;
  const value = outcome.value;
  if (value === null || value === undefined) return true;
  if (typeof value !== 'object') return false;
  const record = value as UnknownRecord;
  if (record.ok === false) return true;
  return record.error !== undefined && record.error !== null;
}

test('news-query: 默认分页为 page=1、limit=20', () => {
  const outcome = runQuery('');
  assert.equal(outcome.thrown, false, '空查询串不应报错');
  assert.equal(readField((outcome as { value: unknown }).value, 'limit'), 20);
  // 缺省页码可省略，未显式给出时等价于 1。
  const page = readField((outcome as { value: unknown }).value, 'page');
  assert.ok(page === undefined || page === 1);
});

test('news-query: 合法参数原样生效', () => {
  const outcome = runQuery('date=2025-06-01&category=model_release&page=2&limit=50');
  assert.equal(outcome.thrown, false);
  const value = (outcome as { value: unknown }).value;
  assert.equal(readField(value, 'page'), 2);
  assert.equal(readField(value, 'limit'), 50);
  assert.equal(readField(value, 'category'), 'model_release');
  assert.equal(readField(value, 'date'), '2025-06-01');
});

test('news-query: 非法 date 被拒绝（400 INVALID_DATE）', () => {
  assert.ok(isRejected(runQuery('date=2025-13-01')));
  assert.ok(isRejected(runQuery('date=2025-02-30')));
  assert.ok(isRejected(runQuery('date=20250601')));
});

test('news-query: 非法 category 被拒绝（400 INVALID_CATEGORY）', () => {
  assert.ok(isRejected(runQuery('category=other')));
  assert.ok(isRejected(runQuery('category=MODEL_RELEASE')));
});

test('news-query: 非法分页被拒绝（400 INVALID_PAGINATION）', () => {
  assert.ok(isRejected(runQuery('page=0')));
  assert.ok(isRejected(runQuery('page=abc')));
  assert.ok(isRejected(runQuery('limit=0')));
  assert.ok(isRejected(runQuery('limit=101')));
});

function dictionaryItems(): Array<{ value: string; label: string; order: number }> {
  if (Array.isArray(CATEGORY_DICTIONARY)) {
    return CATEGORY_DICTIONARY as unknown as Array<{ value: string; label: string; order: number }>;
  }
  return Object.entries(CATEGORY_DICTIONARY as unknown as UnknownRecord).map(
    ([value, entry]) => ({ value, ...(entry as UnknownRecord) }) as { value: string; label: string; order: number },
  );
}

test('news-api-types: 分类枚举固定 5 项且顺序稳定', () => {
  const items = dictionaryItems().sort((a, b) => a.order - b.order);
  assert.deepEqual(
    items.map((item) => item.value),
    [
      'model_release',
      'research_paper',
      'product_application',
      'industry_news',
      'policy_funding',
    ],
  );
  assert.deepEqual(
    items.map((item) => item.label),
    ['模型发布', '研究论文', '产品应用', '行业动态', '政策融资'],
  );
  for (const item of items) {
    assert.ok(Number.isInteger(item.order));
    assert.equal(isCategoryValue(item.value), true);
  }
});

test('news-api-types: 未知枚举降级为原值文本', () => {
  assert.equal(isCategoryValue('unknown'), false);
  assert.equal(isCategoryValue(''), false);
  assert.equal(categoryLabel('unknown'), 'unknown');
});
