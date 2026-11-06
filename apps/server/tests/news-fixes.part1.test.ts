import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDatabase, type DbPool } from '../src/app/news-db';
import { categoryLabel, sourceLabel } from '../src/app/news-constants';
import { normalizeUrl } from '../src/app/news-dedup';
import { DEFAULT_COLLECT_CONFIG } from '../src/app/news-collect';
import { DEFAULT_SOURCE_CONFIG } from '../src/app/news-sources';
import { decodeEntities } from '../src/app/news-collector-arxiv';

test('采集默认端点全部使用 https', () => {
  assert.match(DEFAULT_SOURCE_CONFIG.arxiv.endpoint, /^https:\/\//);
  assert.match(DEFAULT_COLLECT_CONFIG.arxiv.apiBase, /^https:\/\//);
  assert.match(DEFAULT_SOURCE_CONFIG.hackerNews.endpoint, /^https:\/\//);
  assert.match(DEFAULT_SOURCE_CONFIG.jiqizhixin.feedUrl, /^https:\/\//);
});

test('decodeEntities 对越界码点、代理区与未知实体回退原值', () => {
  assert.equal(decodeEntities('&#x1F600;'), '\u{1F600}');
  assert.equal(decodeEntities('&#65;'), 'A');
  assert.equal(decodeEntities('&#x110000;'), '&#x110000;');
  assert.equal(decodeEntities('&#xD800;'), '&#xD800;');
  assert.equal(decodeEntities('&amp;'), '&');
  assert.equal(decodeEntities('&constructor;'), '&constructor;');
});

test('标签查询不命中原型链属性', () => {
  assert.equal(categoryLabel('model_release'), '模型发布');
  assert.equal(categoryLabel('constructor'), 'constructor');
  assert.equal(sourceLabel('arxiv_cs_ai'), 'ArXiv cs.AI');
  assert.equal(sourceLabel('__proto__'), '__proto__');
});

test('normalizeUrl 端口只拼接一次', () => {
  assert.equal(normalizeUrl('https://example.com:8443/a'), 'https://example.com:8443/a');
  assert.equal(normalizeUrl('https://example.com:443/a'), 'https://example.com/a');
  assert.equal(normalizeUrl('http://Example.com/a/?utm_source=x#top'), 'http://example.com/a');
});

test('事务 BEGIN 失败时仍释放连接', async () => {
  const released: string[] = [];
  const client = {
    async query(sql: string) {
      if (sql === 'BEGIN') throw new Error('BEGIN_FAILED');
      return { rows: [], rowCount: 0 };
    },
    release() {
      released.push('release');
    },
  };
  const pool = {
    async query() {
      return { rows: [], rowCount: 0 };
    },
    async connect() {
      return client;
    },
  } as unknown as DbPool;

  const database = createDatabase(pool);
  await assert.rejects(() => database.transaction(async () => 1), /BEGIN_FAILED/);
  assert.deepEqual(released, ['release']);
});
