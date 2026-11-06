import { afterEach, expect, it } from 'vitest';
import { GET } from '../src/api/health/route';
import { InMemoryNewsRepository, setNewsRepository } from '../src/lib/db/repository';
import { setStorageMode } from '../src/lib/bootstrap';

afterEach(() => {
  setNewsRepository(null);
  setStorageMode('memory');
});

it('reports memory storage and does not claim postgres health for in-memory repos', async () => {
  setStorageMode('memory');
  setNewsRepository(new InMemoryNewsRepository());
  const response = await GET();
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.checks.storage).toBe('memory');
  expect(body.checks.database).toBe('ok');
});

it('fails health when postgres storage ping fails', async () => {
  setStorageMode('postgres');
  setNewsRepository({
    async ping() {
      throw new Error('down');
    },
    async insertNews() {
      return { inserted: false };
    },
    async listNews() {
      return { items: [], total: 0, page: 1, limit: 20 };
    },
    async getNewsById() {
      return null;
    },
    async saveSummary() {
      return null;
    },
    async createRun(run) {
      return run;
    },
    async finishRun() {
      return null;
    },
    async saveSourceRun(record) {
      return record;
    },
    async getRun() {
      return null;
    },
    async listRuns() {
      return { items: [], total: 0, page: 1, limit: 20 };
    },
    async findSuccessfulRun() {
      return null;
    },
  });
  const response = await GET();
  expect(response.status).toBe(503);
  const body = await response.json();
  expect(body.checks.storage).toBe('postgres');
  expect(body.checks.database).toBe('error');
});
