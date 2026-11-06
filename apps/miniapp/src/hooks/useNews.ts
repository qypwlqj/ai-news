import { useEffect, useMemo, useSyncExternalStore } from 'react';
import Taro, { usePullDownRefresh, useReachBottom } from '@tarojs/taro';
import type { NewsFilters } from '@ai-news/contracts';
import { NewsFeed } from '../domain/feed';
import { getNews } from '../services/api';

export function useNews(filters: NewsFilters = {}) {
  const feed = useMemo(() => new NewsFeed(getNews), []);
  const state = useSyncExternalStore(
    feed.subscribe,
    feed.getSnapshot,
    feed.getSnapshot,
  );
  const { category, source, date, q } = filters;
  useEffect(() => {
    void feed.setFilters({ category, source, date, q });
  }, [feed, category, source, date, q]);
  useEffect(() => () => feed.dispose(), [feed]);
  usePullDownRefresh(() => {
    void feed.refresh().finally(() => Taro.stopPullDownRefresh());
  });
  useReachBottom(() => {
    void feed.loadMore();
  });
  return {
    ...state,
    refresh: () => feed.refresh(),
    loadMore: () => feed.loadMore(),
  };
}
