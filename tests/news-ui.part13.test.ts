import { describe, expect, it } from 'vitest';

import {
  CATEGORY_PRESENTATION,
  NEUTRAL_TAG,
  SKELETON_CARD_COUNT,
  UI_COPY,
  UI_TOKENS,
  categoryLabel,
  categoryTagView,
  resolveSummaryState,
  skeletonCardView,
  sourceBadgeView,
  sourceLabel,
  stateBlockView,
  summaryBlockView,
} from '../src/app/news-ui';

describe('UI 设计令牌与文案字典', () => {
  it('令牌覆盖颜色/字号/间距/圆角与内容宽度', () => {
    expect(UI_TOKENS.color.accent).toBe('#2563EB');
    expect(UI_TOKENS.maxWidth).toBe(1120);
    expect(UI_TOKENS.radius).toBe(8);
    expect(UI_TOKENS.fontSize.xs).toBeLessThan(UI_TOKENS.fontSize.xl);
    expect(UI_TOKENS.space.lg).toBe(16);
  });

  it('5 类分类字典顺序稳定且文案齐全', () => {
    expect(CATEGORY_PRESENTATION.map((item) => item.value)).toEqual([
      'model_release',
      'research_paper',
      'product_application',
      'industry_news',
      'policy_funding',
    ]);
    expect(CATEGORY_PRESENTATION.map((item) => item.order)).toEqual([1, 2, 3, 4, 5]);
    expect(categoryLabel('research_paper')).toBe('研究论文');
  });

  it('关键文案均非空', () => {
    for (const text of Object.values(UI_COPY)) {
      expect(text.length).toBeGreaterThan(0);
    }
  });
});

describe('未知枚举与缺失字段降级', () => {
  it('未知分类显示原值文本并使用中性样式', () => {
    const view = categoryTagView('brand_new');
    expect(view.label).toBe('brand_new');
    expect(view.known).toBe(false);
    expect(view.style).toEqual({ bg: NEUTRAL_TAG.bg, fg: NEUTRAL_TAG.fg });
    expect(categoryLabel(undefined)).toBe('');
  });

  it('已知分类使用专属底色且不与中性色相同', () => {
    const view = categoryTagView('policy_funding');
    expect(view.known).toBe(true);
    expect(view.label).toBe('政策融资');
    expect(view.style.bg).not.toBe(NEUTRAL_TAG.bg);
  });

  it('未知来源显示原值，缺失来源显示「来源未知」', () => {
    expect(sourceLabel('hacker_news')).toBe('Hacker News');
    expect(sourceLabel('weibo')).toBe('weibo');
    expect(sourceLabel(null)).toBe(UI_COPY.sourceUnknown);
    expect(sourceBadgeView('weibo').known).toBe(false);
    expect(sourceBadgeView('arxiv_cs_ai').known).toBe(true);
  });
});

describe('摘要三态（AC5）', () => {
  it('ok 状态保留全文', () => {
    const view = summaryBlockView({ summary: '一段中文摘要', summaryStatus: 'ok' });
    expect(view.state).toBe('ok');
    expect(view.text).toBe('一段中文摘要');
    expect(view.isPlaceholder).toBe(false);
  });

  it('pending 状态给出骨架与生成中提示', () => {
    const view = summaryBlockView({ summary: null, summaryStatus: 'pending' });
    expect(view.state).toBe('pending');
    expect(view.text).toBe(UI_COPY.summaryPending);
    expect(view.ariaBusy).toBe(true);
  });

  it('failed 状态用中性占位文案，不退化为报错也不隐藏条目', () => {
    const view = summaryBlockView({ summary: null, summaryStatus: 'failed' });
    expect(view.state).toBe('failed');
    expect(view.text).toBe(UI_COPY.summaryFailed);
    expect(view.tone).toBe('warning');
    expect(view.text.length).toBeGreaterThan(0);
  });

  it('ok 但摘要为空按 failed 处理，未知状态降级为 unknown', () => {
    expect(resolveSummaryState({ summary: '', summaryStatus: 'ok' })).toBe('failed');
    expect(resolveSummaryState({ summary: '   ', summaryStatus: 'weird' })).toBe('unknown');
    expect(summaryBlockView({ summary: null, summaryStatus: 'weird' }).text).toBe(UI_COPY.summaryUnknown);
  });
});

describe('骨架卡与状态块', () => {
  it('骨架卡默认 6 张并标记 aria-busy', () => {
    expect(skeletonCardView().count).toBe(SKELETON_CARD_COUNT);
    expect(skeletonCardView().ariaBusy).toBe(true);
    expect(skeletonCardView(0).count).toBe(SKELETON_CARD_COUNT);
    expect(skeletonCardView(3).count).toBe(3);
  });

  it('empty / notfound / hint 各自给出文案与动作', () => {
    expect(stateBlockView('empty').actionLabel).toBe(UI_COPY.viewAll);
    expect(stateBlockView('notfound').title).toBe(UI_COPY.newsNotFound);
    expect(stateBlockView('hint').title).toBe(UI_COPY.noSuccessfulRun);
    expect(stateBlockView('hint').actionLabel).toBeNull();
  });

  it('error 透出脱敏 message 与 requestId，并截断超长文本', () => {
    const view = stateBlockView('error', { message: '  boom\n  at line 1  ', requestId: 'req-1' });
    expect(view.title).toBe(UI_COPY.loadFailed);
    expect(view.message).toBe('boom at line 1');
    expect(view.requestId).toBe('req-1');
    expect(view.actionLabel).toBe(UI_COPY.retry);

    const long = stateBlockView('error', { message: 'x'.repeat(500) });
    expect(long.message?.length).toBe(201);
    expect(long.requestId).toBeNull();
  });
});
