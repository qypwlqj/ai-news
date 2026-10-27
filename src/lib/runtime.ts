import { getNewsRepository, type NewsRepository } from './db/repository';

/** 运行时配置：凭据只从环境变量读取，绝不写日志、不进响应体。 */
export interface RuntimeConfig {
  cronSecret: string | null;
}

type EnvRecord = Record<string, string | undefined>;

function readProcessEnv(): EnvRecord | undefined {
  return (globalThis as { process?: { env?: EnvRecord } }).process?.env;
}

export function readRuntimeConfig(env: EnvRecord | undefined = readProcessEnv()): RuntimeConfig {
  const secret = env?.CRON_SECRET?.trim();
  return { cronSecret: secret ? secret : null };
}

let runtimeConfig: RuntimeConfig | null = null;

export function getRuntimeConfig(): RuntimeConfig {
  if (!runtimeConfig) runtimeConfig = readRuntimeConfig();
  return runtimeConfig;
}

export function setRuntimeConfig(next: RuntimeConfig | null): void {
  runtimeConfig = next;
}

/** 仓储由 Postgres 适配器在启动时注入；未注入时降级为内存实现（测试/无库环境）。 */
export function getRuntimeRepository(): NewsRepository {
  return getNewsRepository();
}

export interface CollectRequestBody {
  date?: string;
  sources?: string[];
  force?: boolean;
}

export interface CollectResponseBody {
  status: string;
  [key: string]: unknown;
}

export type CollectExecutor = (body: CollectRequestBody) => Promise<CollectResponseBody>;

/** 采集服务与路由解耦：导出名由实现侧决定，这里按候选名解析。 */
const COLLECT_EXPORT_CANDIDATES = ['runCollect', 'collectNews', 'runCollection', 'default'] as const;

let collectExecutor: CollectExecutor | null = null;

export function setCollectExecutor(executor: CollectExecutor | null): void {
  collectExecutor = executor;
}

export async function getCollectExecutor(): Promise<CollectExecutor> {
  if (collectExecutor) return collectExecutor;
  const loaded = (await import('./collect')) as unknown as Record<string, unknown>;
  for (const name of COLLECT_EXPORT_CANDIDATES) {
    const candidate = loaded[name];
    if (typeof candidate === 'function') return candidate as CollectExecutor;
  }
  throw new Error('collect service is not available');
}

function nextRequestId(): string {
  const uuid = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.();
  return uuid ?? 'req-' + Date.now().toString(36);
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/** 统一错误信封 { error: { code, message, requestId } }。 */
export function errorResponse(code: string, message: string, status: number): Response {
  return jsonResponse({ error: { code, message, requestId: nextRequestId() } }, status);
}
