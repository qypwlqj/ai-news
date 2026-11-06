import { Button, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { PreviewNotice } from '../../components/PreviewNotice';

export default function About() {
  return (
    <View className="screen about-screen">
      <PreviewNotice />
      <View className="about-brand">
        <Text className="about-symbol">✳</Text>
        <Text className="wordmark">
          AI DAILY<Text className="brand-dot">.</Text>
        </Text>
        <Text className="brand-subtitle">每日 AI · 读懂变化</Text>
      </View>
      <Text className="about-headline">
        让信息，{String.fromCharCode(10)}回归它的价值。
      </Text>
      <Text className="about-lead">
        AI 每天都在变化。{String.fromCharCode(10)}理解它，不必成为一件费力的事。
      </Text>
      <View className="about-principles">
        {[
          [
            '01',
            '从源头出发',
            '连接 Hacker News、arXiv 和机器之心，从研究、开发者社区和产业，看见不同的 AI 进展。',
          ],
          [
            '02',
            '让阅读轻一点',
            '用中文摘要帮助你快速理解内容。重要信息请回到原文核实，AI 摘要不能替代原文。',
          ],
          [
            '03',
            '按自己的节奏',
            '下拉刷新，继续向下阅读；按话题、来源或日期筛选。站内时间统一使用北京时间。',
          ],
        ].map(([index, title, text]) => (
          <View className="principle" key={index}>
            <Text className="principle-index">{index}</Text>
            <View>
              <Text className="principle-title">{title}</Text>
              <Text className="principle-copy">{text}</Text>
            </View>
          </View>
        ))}
      </View>
      <Button
        className="primary-button"
        onClick={() => Taro.switchTab({ url: '/pages/home/index' })}
      >
        回到今天的日报 ↗
      </Button>
      <Text className="about-version">AI DAILY / 0.2 · STAY CURIOUS</Text>
    </View>
  );
}
