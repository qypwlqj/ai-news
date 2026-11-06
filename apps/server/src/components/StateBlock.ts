/**
 * 空态 / 错误态 / 不存在态统一承接组件（纯函数，输出 HTML 片段）。
 * 错误只展示脱敏截断后的 message 与 requestId，绝不回显堆栈、SQL、连接串或令牌。
 */

import { escapeHtmlText, truncateByCodePoints } from './SummaryBlock';

export type StateBlockType = 'empty' | 'error' | 'notfound';

export interface StateBlockProps {
  type: StateBlockType;
  message?: string | null;
  requestId?: string | null;
  actionLabel?: string | null;
  actionHref?: string | null;
}

export const STATE_BLOCK_TITLES: Record<StateBlockType, string> = {
  empty: '今日暂无资讯',
  error: '加载失败，请稍后重试',
  notfound: '资讯不存在或已下线',
};

export const STATE_BLOCK_EMPTY_HINT = '试试切换到「全部」或其它分类';

const MAX_MESSAGE_LENGTH = 200;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const SAFE_HREF_PATTERN = /^(?:\/[^/]|https?:\/\/)/i;

const REDACTION_RULES: ReadonlyArray<{ pattern: RegExp; replacement: string }> = [
  { pattern: /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|rediss?):\/\/\S+/gi, replacement: '[已脱敏]' },
  { pattern: /Bearer\s+[A-Za-z0-9._~+/=-]+/gi, replacement: 'Bearer [已脱敏]' },
  {
    pattern: /[A-Za-z0-9_]*(?:secret|token|password|passwd|api[_-]?key|credential)[A-Za-z0-9_]*\s*[=:]\s*\S+/gi,
    replacement: '[已脱敏]',
  },
];

export function sanitizeStateMessage(message: string | null | undefined): string {
  if (typeof message !== 'string') return '';
  let text = message.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const rule of REDACTION_RULES) text = text.replace(rule.pattern, rule.replacement);
  return truncateByCodePoints(text, MAX_MESSAGE_LENGTH);
}

export function sanitizeRequestId(requestId: string | null | undefined): string | null {
  if (typeof requestId !== 'string') return null;
  const candidate = requestId.trim();
  return REQUEST_ID_PATTERN.test(candidate) ? candidate : null;
}

export function sanitizeActionHref(href: string | null | undefined): string | null {
  if (typeof href !== 'string') return null;
  const candidate = href.trim();
  if (candidate === '/') return candidate;
  return SAFE_HREF_PATTERN.test(candidate) ? candidate : null;
}

export function renderStateBlock(props: StateBlockProps): string {
  const type: StateBlockType = props.type === 'empty' || props.type === 'notfound' ? props.type : 'error';
  const attributes = type === 'error' ? 'role="alert" aria-live="assertive"' : 'role="status" aria-live="polite"';
  const parts: string[] = [
    `<div class="state-block state-block--${type}" ${attributes} data-state="${type}">`,
    `<p class="state-block__title">${STATE_BLOCK_TITLES[type]}</p>`,
  ];
  if (type === 'empty') parts.push(`<p class="state-block__hint">${STATE_BLOCK_EMPTY_HINT}</p>`);
  if (type === 'error') {
    const message = sanitizeStateMessage(props.message);
    if (message) parts.push(`<p class="state-block__message">${escapeHtmlText(message)}</p>`);
    const requestId = sanitizeRequestId(props.requestId);
    if (requestId) parts.push(`<p class="state-block__request-id">requestId: ${escapeHtmlText(requestId)}</p>`);
  }
  const actionHref = sanitizeActionHref(props.actionHref);
  const actionLabel = typeof props.actionLabel === 'string' ? props.actionLabel.trim() : '';
  if (actionHref && actionLabel) {
    parts.push(`<a class="state-block__action" href="${escapeHtmlText(actionHref)}">${escapeHtmlText(actionLabel)}</a>`);
  }
  parts.push('</div>');
  return parts.join('');
}
