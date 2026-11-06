import { Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { CATEGORIES, SOURCE_VALUES, sourceLabel } from '@ai-news/contracts';
import { PreviewNotice } from '../../components/PreviewNotice';

const descriptions = [
  '新能力，从这里开始',
  '在研究里看见未来',
  '让技术走进日常',
  '关注产业的每一步',
  '理解变化背后的力量',
];
const symbols = ['✳', '↗', '◈', '◎', '↗'];
const sourceDescriptions = [
  '开发者社区的一手讨论',
  '人工智能前沿研究',
  '中文 AI 产业与技术视角',
];

export default function Discover() {
  const open = (query: string) =>
    Taro.navigateTo({ url: `/pages/search/index?${query}` });
  return (
    <View className="screen">
      <View className="page-intro">
        <Text className="eyebrow">FOLLOW YOUR INTEREST</Text>
        <Text className="page-title">
          沿着好奇，
          <Text className="headline-line muted-green">发现更多。</Text>
        </Text>
        <Text className="intro-copy">从一个话题出发，打开 AI 的另一面。</Text>
      </View>
      <PreviewNotice />
      <View
        className="search-entry flex items-center"
        onClick={() => open('')}
        role="button"
        aria-label="搜索资讯"
      >
        <View className="search-icon" />
        <Text>找到你关心的进展</Text>
        <Text className="ml-auto">↗</Text>
      </View>
      <View className="section-heading flex items-center justify-between">
        <Text>从话题开始</Text>
        <Text className="section-index">01 — 05</Text>
      </View>
      <View className="topic-grid">
        {CATEGORIES.map((category, index) => (
          <View
            className={`topic-tile topic-${category.value}`}
            key={category.value}
            role="button"
            aria-label={`浏览${category.label}`}
            onClick={() => open(`category=${category.value}`)}
          >
            <View className="flex items-center justify-between">
              <Text className="topic-symbol">{symbols[index]}</Text>
              <Text className="topic-number">0{index + 1}</Text>
            </View>
            <Text className="topic-title">{category.label}</Text>
            <Text className="topic-description">{descriptions[index]}</Text>
          </View>
        ))}
      </View>
      <View className="section-heading flex items-center justify-between">
        <Text>从信源出发</Text>
        <Text className="section-index">DIRECT FROM THE SOURCE</Text>
      </View>
      <View className="source-list">
        {SOURCE_VALUES.map((source, index) => (
          <View
            key={source}
            className="source-row flex items-center"
            role="button"
            aria-label={`浏览${sourceLabel(source)}`}
            onClick={() => open(`source=${source}`)}
          >
            <View className={`source-logo source-logo-${index}`}>
              {['Y', 'α', '机'][index]}
            </View>
            <View className="flex-1">
              <Text className="source-title">{sourceLabel(source)}</Text>
              <Text className="source-description">
                {sourceDescriptions[index]}
              </Text>
            </View>
            <Text className="source-arrow">↗</Text>
          </View>
        ))}
      </View>
      <View className="discovery-note">
        <Text className="quote-mark">“</Text>
        <Text>
          重要的不是知道一切，{String.fromCharCode(10)}而是不停止好奇。
        </Text>
        <Text className="eyebrow mt-4">STAY CURIOUS.</Text>
      </View>
    </View>
  );
}
