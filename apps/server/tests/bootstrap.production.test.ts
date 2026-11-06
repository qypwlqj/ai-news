import { afterEach, describe, expect, it, vi } from 'vitest';
import { getNewsRepository, InMemoryNewsRepository, setNewsRepository } from '../src/lib/db/repository';
import { stopDailyCollect } from '../src/lib/schedule';
import { setRuntimeConfig } from '../src/lib/runtime';

afterEach(async () => {
  stopDailyCollect();
  setNewsRepository(null);
  setRuntimeConfig(null);
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe('production bootstrap', () => {
  it('refuses memory storage when production mode lacks DATABASE_URL', async () => {
    const { bootstrapServer } = await import('../src/lib/bootstrap');
    await expect(
      bootstrapServer({
        NODE_ENV: 'production',
        AI_NEWS_STORAGE: 'postgres',
      }),
    ).rejects.toThrow(/DATABASE_URL/);
  });

  it('injects a postgres repository and registers daily collect when configured', async () => {
    const { bootstrapServer } = await import('../src/lib/bootstrap');
    const stop = vi.fn();
    const schedule = vi.fn(() => ({ stop }));
    const query = vi.fn(async () => ({ rows: [{ ok: 1 }], rowCount: 1 }));
    const close = vi.fn(async () => undefined);
    const runtime = await bootstrapServer(
      {
        AI_NEWS_STORAGE: 'postgres',
        DATABASE_URL: 'postgres://example/ai_news',
        CRON_SECRET: 'test-secret',
      },
      {
        createDatabase: async () => ({ query, close }),
        applySchema: async () => ({ version: 1, executed: 1 }),
        createRepository: (db) => {
          expect(db.query).toBe(query);
          return {
            async ping() {
              await db.query('SELECT 1');
            },
            async insertNews() {
              return { inserted: true };
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
          };
        },
        registerDailyCollect: async (options) => {
          schedule();
          return { stop };
        },
      },
    );
    expect(runtime.storage).toBe('postgres');
    const { getNewsRepository: getRepo, InMemoryNewsRepository: Memory } = await import(
      '../src/lib/db/repository'
    );
    expect(getRepo()).not.toBeInstanceOf(Memory);
    expect(schedule).toHaveBeenCalledTimes(1);
    await runtime.close();
    expect(stop).toHaveBeenCalled();
    expect(close).toHaveBeenCalled();
  });

  it('keeps memory mode for local development without production flags', async () => {
    const { bootstrapServer } = await import('../src/lib/bootstrap');
    const runtime = await bootstrapServer({});
    expect(runtime.storage).toBe('memory');
    const { getNewsRepository: getRepo, InMemoryNewsRepository: Memory } = await import(
      '../src/lib/db/repository'
    );
    expect(getRepo()).toBeInstanceOf(Memory);
    await runtime.close();
  });
});
