import { useState } from 'react';
import { Text, View } from '@tarojs/components';
import Taro, { useShareAppMessage } from '@tarojs/taro';
import type { Category } from '@ai-news/contracts';
import { CategoryTabs } from '../../components/CategoryTabs';
import { FeedContent } from '../../components/FeedContent';
import { PreviewNotice } from '../../components/PreviewNotice';
import { useNews } from '../../hooks/useNews';
import { dateParts } from '../../domain/news';
import { demoMode } from '../../services/api';

export default function Home() {
  const [category, setCategory] = useState<Category>();
  const feed = useNews({ category });
  const date = dateParts(demoMode ? '2026-11-06T08:00:00Z' : Date.now())!;
  useShareAppMessage(() => ({
    title: 'AI DAILY · 每天一点，读懂 AI 的变化',
    path: '/pages/home/index',
  }));
  return (
    <View className="screen home-screen">
      <View className="masthead flex items-center justify-between">
        <View>
          <Text className="wordmark">
            AI DAILY<Text className="brand-dot">.</Text>
          </Text>
          <Text className="brand-subtitle">每日 AI · 读懂变化</Text>
        </View>
        <View className="date-badge">
          <Text className="date-day">
            {date.month}
            <Text className="date-divider">/</Text>
            {date.day}
          </Text>
          <Text className="date-week">星期{date.weekday}</Text>
        </View>
      </View>
      <PreviewNotice />
      <View className="home-intro">
        <Text className="eyebrow">
          <Text className="orange-dot">●</Text> KEEP YOUR CURIOSITY
        </Text>
        <Text className="home-headline">
          今天的 AI，<Text className="headline-line">往前走了哪一步？</Text>
        </Text>
        <Text className="intro-copy">少一点信息噪音，多一点值得读的变化。</Text>
      </View>
      <View
        className="search-entry flex items-center"
        onClick={() => Taro.navigateTo({ url: '/pages/search/index' })}
        role="button"
        aria-label="搜索资讯"
      >
        <View className="search-icon" />
        <Text className="flex-1">搜索模型、论文、你关心的 AI…</Text>
        <Text className="search-entry-arrow">↗</Text>
      </View>
      <CategoryTabs value={category} onChange={setCategory} />
      <FeedContent
        state={feed}
        retry={feed.refresh}
        loadMore={feed.loadMore}
        featured={!category}
      />
    </View>
  );
}
