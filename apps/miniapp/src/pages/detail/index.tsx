import { useEffect, useState } from 'react';
import { Button, Text, View } from '@tarojs/components';
import Taro, { useRouter, useShareAppMessage } from '@tarojs/taro';
import { categoryLabel, sourceLabel, type NewsItem } from '@ai-news/contracts';
import { getNewsDetail, demoMode } from '../../services/api';
import {
  dateParts,
  newsDisplay,
  safeOriginalUrl,
  summaryText,
} from '../../domain/news';
import { PreviewNotice } from '../../components/PreviewNotice';

export default function Detail() {
  const { params } = useRouter();
  const id = params.id ?? '';
  const [item, setItem] = useState<NewsItem | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setError('');
    setItem(null);
    getNewsDetail(id)
      .then((value) => {
        if (current) setItem(value);
      })
      .catch((error) => {
        if (current)
          setError(error instanceof Error ? error.message : '暂时无法加载资讯');
      });
    return () => {
      current = false;
    };
  }, [id, attempt]);
  useShareAppMessage(() => ({
    title: item ? newsDisplay(item).title : 'AI DAILY · 值得读的 AI 资讯',
    path: `/pages/detail/index?id=${encodeURIComponent(id)}`,
  }));
  const goBack = () =>
    Taro.navigateBack().catch(() =>
      Taro.switchTab({ url: '/pages/home/index' }),
    );
  const original = item ? safeOriginalUrl(item.url) : null;
  const copy = async (text: string, success: string) => {
    try {
      await Taro.setClipboardData({ data: text });
      await Taro.showToast({ title: success, icon: 'success' });
    } catch {
      void Taro.showToast({ title: '复制失败，请重试', icon: 'none' });
    }
  };
  if (!item)
    return (
      <View className="screen">
        <Button className="back-button" onClick={goBack}>
          ← 返回列表
        </Button>
        {error ? (
          <View className="empty-state">
            <Text className="empty-symbol">↻</Text>
            <Text className="empty-title">{error}</Text>
            <Text className="empty-copy">你可以重新加载，或返回继续阅读。</Text>
            <Button
              className="secondary-button"
              onClick={() => setAttempt((value) => value + 1)}
            >
              重新加载
            </Button>
          </View>
        ) : (
          <View className="skeleton-card">
            <View className="skeleton skeleton-title" />
            <View className="skeleton skeleton-title" />
            <View className="skeleton skeleton-detail" />
          </View>
        )}
      </View>
    );
  const date = dateParts(item.publishedAt);
  const view = newsDisplay(item);
  return (
    <View className="screen detail-screen">
      <Button className="back-button" onClick={goBack}>
        ← 返回列表
      </Button>
      <PreviewNotice />
      <View className="detail-heading">
        <View className="flex items-center justify-between">
          <Text className={`category-label category-${item.category}`}>
            {categoryLabel(item.category)}
          </Text>
          <Text className="detail-edition">A CLOSER LOOK</Text>
        </View>
        <Text className="detail-title" selectable>
          {view.title}
        </Text>
        {view.subtitle ? (
          <Text className="detail-original-title" selectable>
            {view.subtitle}
          </Text>
        ) : null}
        <View className="detail-meta flex items-center">
          <Text className="source-dot">●</Text>
          <Text>{sourceLabel(item.source)}</Text>
          {view.author ? (
            <>
              <Text className="meta-separator">/</Text>
              <Text>{view.author}</Text>
            </>
          ) : null}
          <Text className="meta-separator">/</Text>
          <Text>
            {date ? `${date.month}月${date.day}日 ${date.time}` : '日期未知'}
          </Text>
        </View>
      </View>
      <View className="digest-panel">
        <View className="digest-top flex items-center justify-between">
          <Text className="digest-label">
            <Text className="digest-star">✳</Text>{' '}
            {demoMode ? '示例摘要' : 'AI 摘要'}
          </Text>
          <Text className="digest-index">THE ESSENTIALS</Text>
        </View>
        <Text className="digest-text" selectable>
          {summaryText(item)}
        </Text>
        <View className="digest-footer">
          <Text>保留重点，给思考留一点空间。</Text>
          <Text>↗</Text>
        </View>
      </View>
      {view.excerpt ? (
        <View className="original-panel">
          <View className="digest-top flex items-center justify-between">
            <Text className="original-label">原文</Text>
            <Text className="digest-index">FROM THE SOURCE</Text>
          </View>
          <Text className="original-text" selectable>
            {view.excerpt}
          </Text>
        </View>
      ) : null}
      <View className="reading-reminder">
        <Text className="reading-reminder-title">读到这里，再往深处一点。</Text>
        <Text>
          {demoMode
            ? '本篇是设计示例，不代表真实新闻。你可以体验阅读、复制摘要和分类探索。'
            : '摘要由 AI 辅助生成，可能存在遗漏或偏差。复制原文链接，在浏览器中查看完整报道，以原文为准。'}
        </Text>
      </View>
      <View className="detail-colophon">
        <Text>
          AI DAILY<Text className="brand-dot">.</Text>
        </Text>
        <Text>保持好奇，保持思考。</Text>
      </View>
      <View className="detail-actions">
        <Button
          className="share-button"
          openType={process.env.TARO_ENV === 'weapp' ? 'share' : undefined}
          onClick={
            process.env.TARO_ENV === 'h5'
              ? () =>
                  void copy(`${view.title}\n${summaryText(item)}`, '摘要已复制')
              : undefined
          }
        >
          {process.env.TARO_ENV === 'weapp' ? '分享' : '复制摘要'}
        </Button>
        <Button
          className="primary-button flex-1"
          disabled={!original}
          onClick={() => original && void copy(original, '链接已复制')}
        >
          {original
            ? '复制原文链接 ↗'
            : demoMode
              ? '示例暂无原文链接'
              : '暂时没有原文链接'}
        </Button>
      </View>
    </View>
  );
}
