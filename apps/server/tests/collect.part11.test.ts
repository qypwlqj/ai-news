import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ALL_SOURCES,
  CATEGORIES,
  DEFAULT_CATEGORY,
  MAX_ATTEMPTS,
  isValidDate,
  shanghaiDate,
} from '../src/lib/collect';

test('shanghaiDate：UTC 日界按 Asia/Shanghai 自然日换算', () => {
  assert.equal(shanghaiDate(new Date('2025-05-31T15:59:59.000Z')), '2025-05-31');
  assert.equal(shanghaiDate(new Date('2025-05-31T16:00:00.000Z')), '2025-06-01');
});

test('shanghaiDate：跨年边界 +08:00 固定偏移', () => {
  assert.equal(shanghaiDate(new Date('2025-12-31T15:59:59.000Z')), '2025-12-31');
  assert.equal(shanghaiDate(new Date('2025-12-31T16:00:00.000Z')), '2026-01-01');
});

test('isValidDate：只接受 YYYY-MM-DD 且真实存在的日期', () => {
  assert.equal(isValidDate('2025-06-01'), true);
  assert.equal(isValidDate('2025-6-1'), false);
  assert.equal(isValidDate('2025-13-01'), false);
  assert.equal(isValidDate(''), false);
});

test('采集常量：3 来源、5 分类、默认分类兜底、最多 3 次尝试', () => {
  assert.deepEqual([...ALL_SOURCES], ['hacker_news', 'arxiv_cs_ai', 'jiqizhixin']);
  assert.equal(CATEGORIES.length, 5);
  assert.deepEqual([...CATEGORIES], [
    'model_release',
    'research_paper',
    'product_application',
    'industry_news',
    'policy_funding',
  ]);
  assert.equal(CATEGORIES.includes(DEFAULT_CATEGORY), true);
  assert.equal(DEFAULT_CATEGORY, 'industry_news');
  assert.equal(MAX_ATTEMPTS, 3);
});
