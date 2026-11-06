import { Image, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { categoryLabel, sourceLabel, type NewsItem } from '@ai-news/contracts';
import { dateParts, summaryText } from '../domain/news';
import orbit from '../assets/orbit.png';

export function NewsCard({
  item,
  featured = false,
}: {
  item: NewsItem;
  featured?: boolean;
}) {
  const date = dateParts(item.publishedAt);
  const open = () =>
    Taro.navigateTo({
      url: `/pages/detail/index?id=${encodeURIComponent(item.id)}`,
    });
  if (featured)
    return (
      <View
        className="focus-card bg-white overflow-hidden"
        onClick={open}
        role="button"
        aria-label={`阅读 ${item.title}`}
      >
        <View className="focus-image-wrap">
          <Image className="focus-image" src={orbit} mode="aspectFill" />
          <View className="focus-label">
            本期关注 <Text className="ml-2">↗</Text>
          </View>
        </View>
        <View className="focus-body">
          <View className="flex items-center justify-between">
            <Text className={`category-label category-${item.category}`}>
              {categoryLabel(item.category)}
            </Text>
            <Text className="meta">{sourceLabel(item.source)}</Text>
          </View>
          <Text className="focus-title">{item.title}</Text>
          <Text className="summary two-lines">{summaryText(item)}</Text>
          <View className="focus-footer flex items-center justify-between">
            <Text className="meta">
              {date ? `${date.month}.${date.day} · ${date.time}` : '日期未知'}
            </Text>
            <Text className="read-label">
              读一读 <Text className="ml-2">↗</Text>
            </Text>
          </View>
        </View>
      </View>
    );
  return (
    <View
      className="news-card bg-white"
      onClick={open}
      role="button"
      aria-label={`阅读 ${item.title}`}
    >
      <View className="flex items-center justify-between">
        <Text className={`category-label category-${item.category}`}>
          {categoryLabel(item.category)}
        </Text>
        <Text className="meta">
          {date ? `${date.month}.${date.day} ${date.time}` : '日期未知'}
        </Text>
      </View>
      <Text className="news-title">{item.title}</Text>
      <Text className="summary two-lines">{summaryText(item)}</Text>
      <View className="flex items-center justify-between mt-4">
        <Text className="source-caption">
          <Text className="source-dot">●</Text> {sourceLabel(item.source)}
        </Text>
        <Text className="card-arrow">↗</Text>
      </View>
    </View>
  );
}
