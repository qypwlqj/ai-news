/**
 * 运行期配置集中解析（数据库 / 定时任务令牌 / LLM）。
 * 只读注入的环境变量记录：不打印、不落库、不写入响应；对外仅暴露 configSummary() 的布尔摘要。
 */

export type EnvSource = Record<string, string | undefined>;

export interface DatabaseConfig {
  connectionString: string | null;
  maxConnections: number;
  statementTimeoutMs: number;
  ssl: boolean;
}

export interface CronConfig {
  /** 仅来自环境变量，禁止落库 / 日志 / 示例写具体值。 */
  secret: string | null;
}

export interface LlmConfig {
  provider: string;
  model: string;
  apiKey: string | null;
  baseUrl: string | null;
  timeoutMs: number;
}

export interface AppConfig {
  database: DatabaseConfig;
  cron: CronConfig;
  llm: LlmConfig;
  /** 缺失配置项的「名称」列表（绝不包含值）。 */
  missing: string[];
}

export const ENV_KEYS = {
  databaseUrl: 'DATABASE_URL',
  databasePoolMax: 'DATABASE_POOL_MAX',
  databaseStatementTimeout: 'DATABASE_STATEMENT_TIMEOUT_MS',
  databaseSsl: 'DATABASE_SSL',
  cronSecret: 'CRON_SECRET',
  llmProvider: 'LLM_PROVIDER',
  llmModel: 'LLM_MODEL',
  llmApiKey: 'LLM_API_KEY',
  llmBaseUrl: 'LLM_BASE_URL',
  llmTimeout: 'LLM_TIMEOUT_MS',
} as const;

export const DEFAULT_DATABASE_POOL_MAX = 10;
export const DEFAULT_STATEMENT_TIMEOUT_MS = 10_000;
export const DEFAULT_LLM_PROVIDER = 'openai-compatible';
export const DEFAULT_LLM_MODEL = 'gpt-4o-mini';
export const DEFAULT_LLM_TIMEOUT_MS = 8_000;

function readText(env: EnvSource, key: string): string | null {
  const raw = env[key];
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value.length > 0 ? value : null;
}

function readInt(env: EnvSource, key: string, fallback: number, min: number, max: number): number {
  const raw = readText(env, key);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const value = Math.trunc(parsed);
  return value < min || value > max ? fallback : value;
}

function readFlag(env: EnvSource, key: string): boolean {
  const raw = readText(env, key)?.toLowerCase() ?? null;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'require';
}

/** 纯函数：从注入的 env 记录解析配置，缺失项只记录名称。 */
export function parseConfig(env: EnvSource = {}): AppConfig {
  const connectionString = readText(env, ENV_KEYS.databaseUrl);
  const cronSecret = readText(env, ENV_KEYS.cronSecret);
  const llmApiKey = readText(env, ENV_KEYS.llmApiKey);
  const missing: string[] = [];
  if (connectionString === null) missing.push(ENV_KEYS.databaseUrl);
  if (cronSecret === null) missing.push(ENV_KEYS.cronSecret);
  if (llmApiKey === null) missing.push(ENV_KEYS.llmApiKey);

  return {
    database: {
      connectionString,
      maxConnections: readInt(env, ENV_KEYS.databasePoolMax, DEFAULT_DATABASE_POOL_MAX, 1, 100),
      statementTimeoutMs: readInt(env, ENV_KEYS.databaseStatementTimeout, DEFAULT_STATEMENT_TIMEOUT_MS, 100, 300_000),
      ssl: readFlag(env, ENV_KEYS.databaseSsl),
    },
    cron: { secret: cronSecret },
    llm: {
      provider: readText(env, ENV_KEYS.llmProvider) ?? DEFAULT_LLM_PROVIDER,
      model: readText(env, ENV_KEYS.llmModel) ?? DEFAULT_LLM_MODEL,
      apiKey: llmApiKey,
      baseUrl: readText(env, ENV_KEYS.llmBaseUrl),
      timeoutMs: readInt(env, ENV_KEYS.llmTimeout, DEFAULT_LLM_TIMEOUT_MS, 100, 120_000),
    },
    missing,
  };
}

export interface ConfigSummary {
  database: { configured: boolean; maxConnections: number; statementTimeoutMs: number; ssl: boolean };
  cron: { secretConfigured: boolean };
  llm: { provider: string; model: string; apiKeyConfigured: boolean; timeoutMs: number };
  missing: string[];
}

/** 脱敏摘要：只含布尔与数值，可安全写日志或探活响应。 */
export function configSummary(config: AppConfig): ConfigSummary {
  return {
    database: {
      configured: config.database.connectionString !== null,
      maxConnections: config.database.maxConnections,
      statementTimeoutMs: config.database.statementTimeoutMs,
      ssl: config.database.ssl,
    },
    cron: { secretConfigured: config.cron.secret !== null },
    llm: {
      provider: config.llm.provider,
      model: config.llm.model,
      apiKeyConfigured: config.llm.apiKey !== null,
      timeoutMs: config.llm.timeoutMs,
    },
    missing: [...config.missing],
  };
}

let current: AppConfig | null = null;

/** 由运行时/测试注入已解析配置；不读取任何环境变量。 */
export function setAppConfig(config: AppConfig | null): void {
  current = config;
}

export function hasAppConfig(): boolean {
  return current !== null;
}

export function getAppConfig(): AppConfig {
  if (current === null) throw new Error('app config is not configured');
  return current;
}
