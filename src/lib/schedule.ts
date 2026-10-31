/** 应用内定时采集：node-cron 每日 08:00（Asia/Shanghai），与 POST /api/cron/collect 共用同一服务函数。 */
export const DAILY_CRON_EXPRESSION = '0 8 * * *';
export const SCHEDULE_TIME_ZONE = 'Asia/Shanghai';

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;
const RUN_HOUR = 8;

export interface CronTaskLike {
  stop(): void;
}

export interface CronLike {
  schedule(expression: string, fn: () => void, options: { timeZone: string }): CronTaskLike;
}

export type ModuleImporter = (specifier: string) => Promise<unknown>;

/** 动态加载是唯一依赖点：未安装 node-cron 时不影响其它模块加载。 */
export const defaultImporter: ModuleImporter = (specifier) => import(/* @vite-ignore */ specifier);

export async function loadCron(importer: ModuleImporter = defaultImporter): Promise<CronLike> {
  const loaded = await importer('node-cron');
  const candidate = (loaded as { default?: unknown } | null)?.default ?? loaded;
  const schedule = (candidate as { schedule?: unknown } | null)?.schedule;
  if (typeof schedule !== 'function') throw new Error('node-cron is unavailable: schedule() not found');
  return candidate as CronLike;
}

/** 下一次 08:00 Asia/Shanghai 对应的 UTC 时刻（上海无夏令时，固定 +08:00）。 */
export function nextRunAt(now: Date = new Date()): Date {
  const shifted = new Date(now.getTime() + SHANGHAI_OFFSET_MS);
  const localTarget = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(), RUN_HOUR, 0, 0, 0);
  let nextUtc = localTarget - SHANGHAI_OFFSET_MS;
  if (nextUtc <= now.getTime()) nextUtc += DAY_MS;
  return new Date(nextUtc);
}

export interface DailyCollectOptions {
  cron?: CronLike;
  importer?: ModuleImporter;
  timeZone?: string;
  run: () => Promise<unknown>;
  onError?: (error: unknown) => void;
}

let registered: CronTaskLike | null = null;

export async function registerDailyCollect(options: DailyCollectOptions): Promise<CronTaskLike> {
  const cron = options.cron ?? (await loadCron(options.importer));
  registered?.stop();
  const task = cron.schedule(
    DAILY_CRON_EXPRESSION,
    () => {
      void options.run().catch((error) => options.onError?.(error));
    },
    { timeZone: options.timeZone ?? SCHEDULE_TIME_ZONE },
  );
  registered = task;
  return task;
}

export function stopDailyCollect(): void {
  registered?.stop();
  registered = null;
}
