/**
 * 摘要区展示组件（纯函数，输出 HTML 片段）：ok / pending / failed 三态降级，
 * 未知 summaryStatus 一律中性展示原文摘要，绝不隐藏条目（AC5）。
 */

export const SUMMARY_PENDING_TEXT = '摘要生成中…';
export const SUMMARY_FAILED_TEXT = '摘要生成失败，可点击标题阅读原文';
export const SUMMARY_UNAVAILABLE_TEXT = '暂无摘要';

export const MAX_SUMMARY_DISPLAY_LENGTH = 200;

export type SummaryDisplayState = 'ok' | 'pending' | 'failed' | 'unknown';

export interface SummaryBlockProps {
  summary?: string | null;
  summaryStatus?: string | null;
}

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtmlText(value: string): string {
  return String(value).replace(/[&<>"']/g, (char) => ESCAPE_MAP[char] as string);
}

/** 按码点截断，避免代理对（emoji）被截成半个字符。 */
export function truncateByCodePoints(value: string, max: number): string {
  const points = Array.from(value);
  return points.length <= max ? value : points.slice(0, max).join('');
}

export function normalizeSummaryText(summary: string | null | undefined): string {
  if (typeof summary !== 'string') return '';
  return summary.replace(/\s+/g, ' ').trim();
}

export function resolveSummaryState(
  summaryStatus: string | null | undefined,
  summary: string | null | undefined,
): SummaryDisplayState {
  const text = normalizeSummaryText(summary);
  if (summaryStatus === 'ok') return text ? 'ok' : 'failed';
  if (summaryStatus === 'pending') return 'pending';
  if (summaryStatus === 'failed') return 'failed';
  return 'unknown';
}

export function renderSummaryBlock(props: SummaryBlockProps = {}): string {
  const state = resolveSummaryState(props.summaryStatus, props.summary);
  const text = truncateByCodePoints(normalizeSummaryText(props.summary), MAX_SUMMARY_DISPLAY_LENGTH);
  if (state === 'pending') {
    return `<p class="news-summary news-summary--pending" aria-busy="true" data-summary-state="pending">${SUMMARY_PENDING_TEXT}</p>`;
  }
  if (state === 'ok') {
    return `<p class="news-summary" data-summary-state="ok">${escapeHtmlText(text)}</p>`;
  }
  if (state === 'failed') {
    return `<p class="news-summary news-summary--failed" data-summary-state="failed">${SUMMARY_FAILED_TEXT}</p>`;
  }
  const fallback = text || SUMMARY_UNAVAILABLE_TEXT;
  return `<p class="news-summary news-summary--unknown" data-summary-state="unknown">${escapeHtmlText(fallback)}</p>`;
}
