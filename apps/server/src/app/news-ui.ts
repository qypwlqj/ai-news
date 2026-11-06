/**
 * 一期 UI 基础层：设计令牌 + 集中文案字典 + 基础展示视图构造器。
 *
 * 约定：
 * - 令牌只描述视觉常量（颜色/字号/间距/圆角/断点），组件直接引用，禁止散落硬编码。
 * - 可见文案集中在本文件 `UI_COPY`，组件不得内联中文文案。
 * - 未知枚举值降级为原值文本 + 中性样式，不报错、不隐藏条目（对齐接口兼容规则 2）。
 * - 视图构造器是纯函数：输入接口字段，输出可渲染的展示描述，不发请求、不读环境变量。
 * - 摘要三态：ok 正常展示；pending 骨架 + 「摘要生成中…」；failed 中性占位且条目照常可点。
 * 因此 `summaryStatus=failed` 的条目长期可见可点（AC5）。
 */

export const UI_TOKENS = {
  color: {
    pageBg: '#FFFFFF',
    pageBgDark: '#0B0F14',
    cardBg: '#FFFFFF',
    cardBgDark: '#111820',
    text: '#111827',
    textDark: '#E5E7EB',
    muted: '#6B7280',
    mutedDark: '#9CA3AF',
    border: '#E5E7EB',
    borderDark: '#1F2937',
    accent: '#2563EB',
    warning: '#B45309',
    skeleton: '#F3F4F6',
  },
  fontSize: { xs: 12, sm: 14, md: 16, lg: 20, xl: 28 },
  lineHeight: { body: 1.5, prose: 1.7 },
  fontWeight: { regular: 400, medium: 500, semibold: 600 },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 },
  radius: 8,
  shadow: '0 1px 2px rgba(0,0,0,.06)',
  maxWidth: 1120,
  breakpoints: { sm: 640, md: 768, lg: 1024, xl: 1280 },
} as const;

/** 中性灰标签：未知枚举与缺失字段统一降级样式。 */
export const NEUTRAL_TAG = { bg: '#F3F4F6', fg: '#374151' } as const;

export interface CategoryPresentation {
  value: string;
  label: string;
  order: number;
  bg: string;
  fg: string;
}

/** 5 类固定枚举的展示名与低饱和底色，顺序稳定（与 category_enum 一致）。 */
export const CATEGORY_PRESENTATION: CategoryPresentation[] = [
  { value: 'model_release', label: '模型发布', order: 1, bg: '#EFF6FF', fg: '#1D4ED8' },
  { value: 'research_paper', label: '研究论文', order: 2, bg: '#F5F3FF', fg: '#6D28D9' },
  { value: 'product_application', label: '产品应用', order: 3, bg: '#ECFDF5', fg: '#047857' },
  { value: 'industry_news', label: '行业动态', order: 4, bg: '#F3F4F6', fg: '#374151' },
  { value: 'policy_funding', label: '政策融资', order: 5, bg: '#FFF7ED', fg: '#B45309' },
];

const CATEGORY_BY_VALUE = new Map(CATEGORY_PRESENTATION.map((item) => [item.value, item]));

/** 来源展示名；未知来源降级为原值文本。 */
export const SOURCE_LABELS: Record<string, string> = {
  hacker_news: 'Hacker News',
  arxiv_cs_ai: 'ArXiv cs.AI',
  jiqizhixin: '机器之心',
};

export const UI_COPY = {
  sourceUnknown: '来源未知',
  dateMissing: '—',
  summaryPending: '摘要生成中…',
  summaryFailed: '摘要生成失败，可点击标题阅读原文',
  summaryUnknown: '摘要状态未知',
  readOriginal: '阅读原文 ↗',
  loadFailed: '加载失败，请稍后重试',
  retry: '重试',
  emptyCategory: '该分类今日暂无资讯',
  viewAll: '查看全部',
  newsNotFound: '资讯不存在或已下线',
  runNotFound: '批次不存在',
  backHome: '返回首页',
  noSuccessfulRun: '今日尚无成功采集批次',
  previousPage: '上一页',
  nextPage: '下一页',
} as const;

/** 分类展示名：未知值降级为原值文本，空值返回空串。 */
export function categoryLabel(value: string | null | undefined): string {
  if (!value) return '';
  return CATEGORY_BY_VALUE.get(value)?.label ?? value;
}

/** 来源展示名：未知值降级为原值文本，缺失显示「来源未知」。 */
export function sourceLabel(value: string | null | undefined): string {
  const key = (value ?? '').trim();
  if (!key) return UI_COPY.sourceUnknown;
  return SOURCE_LABELS[key] ?? key;
}

export interface BadgeView {
  label: string;
  known: boolean;
  style: { bg: string; fg: string };
}

/** SourceBadge 视图：来源胶囊，未知来源用中性灰并保留原值。 */
export function sourceBadgeView(source: string | null | undefined): BadgeView {
  const key = (source ?? '').trim();
  const known = key !== '' && Object.prototype.hasOwnProperty.call(SOURCE_LABELS, key);
  return { label: sourceLabel(key), known, style: { ...NEUTRAL_TAG } };
}

/** CategoryTag 视图：5 类之一用专属低饱和色，未知值用中性灰并保留原值。 */
export function categoryTagView(value: string | null | undefined): BadgeView {
  const key = (value ?? '').trim();
  const known = CATEGORY_BY_VALUE.get(key);
  if (known) return { label: known.label, known: true, style: { bg: known.bg, fg: known.fg } };
  return { label: key, known: false, style: { ...NEUTRAL_TAG } };
}

export type SummaryState = 'ok' | 'pending' | 'failed' | 'unknown';

export interface SummaryBlockView {
  state: SummaryState;
  text: string;
  tone: 'default' | 'muted' | 'warning';
  ariaBusy: boolean;
  isPlaceholder: boolean;
}

/** 摘要三态判定：failed 与空摘要都降级为占位，绝不隐藏条目。 */
export function resolveSummaryState(item: {
  summary?: string | null;
  summaryStatus?: string | null;
}): SummaryState {
  const status = (item.summaryStatus ?? '').trim();
  const summary = (item.summary ?? '').trim();
  if (status === 'pending') return 'pending';
  if (status === 'failed') return 'failed';
  if (status === 'ok') return summary ? 'ok' : 'failed';
  if (summary && !status) return 'ok';
  return 'unknown';
}

/** SummaryBlock 视图：ok 保留全文（按 3 行截断由样式完成），其余走占位文案。 */
export function summaryBlockView(item: {
  summary?: string | null;
  summaryStatus?: string | null;
}): SummaryBlockView {
  const state = resolveSummaryState(item);
  switch (state) {
    case 'ok':
      return { state, text: (item.summary ?? '').trim(), tone: 'default', ariaBusy: false, isPlaceholder: false };
    case 'pending':
      return { state, text: UI_COPY.summaryPending, tone: 'muted', ariaBusy: true, isPlaceholder: true };
    case 'failed':
      return { state, text: UI_COPY.summaryFailed, tone: 'warning', ariaBusy: false, isPlaceholder: true };
    default:
      return { state: 'unknown', text: UI_COPY.summaryUnknown, tone: 'muted', ariaBusy: false, isPlaceholder: true };
  }
}

/** 首屏骨架卡数量：与列表容器同宽同 padding，消除布局抖动（CLS < 0.1）。 */
export const SKELETON_CARD_COUNT = 6;

export interface SkeletonCardView {
  count: number;
  ariaBusy: true;
  style: { bg: string; radius: number };
}

export function skeletonCardView(count: number = SKELETON_CARD_COUNT): SkeletonCardView {
  const safe = Number.isFinite(count) && count > 0 ? Math.floor(count) : SKELETON_CARD_COUNT;
  return { count: safe, ariaBusy: true, style: { bg: UI_TOKENS.color.skeleton, radius: UI_TOKENS.radius } };
}

export type StateBlockType = 'empty' | 'error' | 'notfound' | 'hint';

export interface StateBlockView {
  type: StateBlockType;
  title: string;
  message: string | null;
  requestId: string | null;
  actionLabel: string | null;
}

const STATE_MESSAGE_MAX_CHARS = 200;

/** 展示用 message 二次兜底：压平空白并截断，避免回显堆栈或超长文本。 */
function safeMessage(message: string | null | undefined): string | null {
  const text = (message ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > STATE_MESSAGE_MAX_CHARS ? `${text.slice(0, STATE_MESSAGE_MAX_CHARS)}…` : text;
}

/** StateBlock 视图：empty / error / notfound / hint，error 透出脱敏 message 与 requestId。 */
export function stateBlockView(
  type: StateBlockType,
  options: { message?: string | null; requestId?: string | null; title?: string | null } = {},
): StateBlockView {
  const requestId = (options.requestId ?? '').trim() || null;
  const message = safeMessage(options.message);
  switch (type) {
    case 'error':
      return { type, title: options.title?.trim() || UI_COPY.loadFailed, message, requestId, actionLabel: UI_COPY.retry };
    case 'empty':
      return { type, title: options.title?.trim() || UI_COPY.emptyCategory, message, requestId, actionLabel: UI_COPY.viewAll };
    case 'notfound':
      return { type, title: options.title?.trim() || UI_COPY.newsNotFound, message, requestId, actionLabel: UI_COPY.backHome };
    default:
      return { type: 'hint', title: options.title?.trim() || UI_COPY.noSuccessfulRun, message, requestId, actionLabel: null };
  }
}
