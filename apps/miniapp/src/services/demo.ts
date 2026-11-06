import type { NewsItem, NewsPage, NewsQuery } from '@ai-news/contracts';
import { dateParts } from '../domain/news';

// Illustrative editorial content. Only imported when TARO_APP_DEMO=true at build time.
const entries = [
  [
    'model_release',
    'hacker_news',
    '从回答问题，到完成任务：AI 的下一站',
    '当模型开始使用工具、拆解任务并理解上下文，AI 的价值也从一次对话走向完整工作流。真正值得观察的，是可靠性、成本，以及人与智能体如何协作。',
  ],
  [
    'research_paper',
    'arxiv_cs_ai',
    '模型如何得出答案？让推理过程更透明',
    '答案之外，推理路径同样值得关注。从中间步骤到结果验证，研究者正在探索更可解释的评估方式，让模型的能力边界变得清晰，也帮助人们理解模型何时需要更多指导。',
  ],
  [
    'product_application',
    'jiqizhixin',
    'AI 编程的下一步，是理解整个项目',
    '从补全一行代码到理解项目结构，开发工具正在改变人与代码的关系。上下文管理、任务分解以及开发者对结果的判断，正成为协作过程中的重要环节。',
  ],
  [
    'industry_news',
    'hacker_news',
    '开放模型，正在走向效率与可用性',
    '模型规模之外，推理成本、部署门槛与社区生态逐渐成为重要维度。对于构建实际产品的团队，稳定、可控和易于集成，同样决定了技术的长期价值。',
  ],
  [
    'research_paper',
    'arxiv_cs_ai',
    '当语言模型遇见真实世界',
    '文字、图像与声音为理解世界提供了不同视角。多模态学习需要解决的，不只是信息融合，还有跨场景的泛化与细粒度对齐，让模型能够理解更加复杂的环境。',
  ],
  [
    'policy_funding',
    'jiqizhixin',
    '从技术到产业，寻找 AI 的长期价值',
    '技术突破如何变成可持续的产品？这一阅读示例梳理需求验证、使用成本与商业模式之间的关系，帮助读者建立观察产业的框架，并思考技术落地后的价值。',
  ],
  [
    'product_application',
    'hacker_news',
    '把信息整理成知识：个人 AI 工作流',
    '收集并不等于理解。一个好的信息工作流，应当帮助我们筛选、连接和回顾知识，让工具服务于思考，减少重复整理的负担，也为注意力留出空间。',
  ],
  [
    'model_release',
    'jiqizhixin',
    '小模型，大空间：端侧智能的可能性',
    '在设备本地运行的模型，为隐私、延迟和离线体验带来了新的设计空间。端侧应用需要在模型能力、设备性能和能耗之间找到平衡，让技术更自然地融入日常生活。',
  ],
  [
    'industry_news',
    'hacker_news',
    '衡量 AI 产品，还需要哪些指标？',
    '准确率只是起点。任务完成率、可恢复性和用户信任，共同决定一个 AI 产品能否被持续使用。评估也应当走进真实的使用环境，理解任务与人的关系。',
  ],
  [
    'research_paper',
    'arxiv_cs_ai',
    '长上下文之外，模型如何记住重要信息',
    '更长的输入不一定带来更好的理解。信息选择、检索与记忆更新，正在成为构建可靠系统的重要议题。我们需要关注模型如何在大量材料中找到真正相关的线索。',
  ],
  [
    'product_application',
    'jiqizhixin',
    '把研究变成日常工具，需要跨过什么',
    '一个演示距离一个稳定的工具，往往还隔着复杂的使用场景。产品设计应当为不确定性留出空间，提供明确反馈、失败恢复，以及让用户持续掌握决定权的方式。',
  ],
  [
    'industry_news',
    'hacker_news',
    '为 AI 时代保留自己的判断力',
    '工具可以帮助我们获取和整理信息，但理解仍需要人的参与。保持好奇、核实来源、比较不同观点，让信息成为思考的起点，而不是替代独立判断的结论。',
  ],
] as const;

export const demoNews: NewsItem[] = entries.map(
  ([category, source, title, summary], index) => ({
    id: `sample-${index + 1}`,
    category,
    source,
    title,
    summary,
    summaryStatus: 'ok',
    url: '',
    publishedAt: new Date(
      Date.UTC(2026, 10, 6, 8) - index * 30 * 60 * 1000,
    ).toISOString(),
  }),
);

export function getDemoPage(query: NewsQuery): NewsPage {
  const page = query.page ?? 1;
  const limit = query.limit ?? 10;
  const items = demoNews.filter(
    (item) =>
      (!query.category || query.category === item.category) &&
      (!query.source || query.source === item.source) &&
      (!query.date || query.date === dateParts(item.publishedAt)?.date) &&
      (!query.q ||
        `${item.title} ${item.summary}`
          .toLowerCase()
          .includes(query.q.toLowerCase())),
  );
  const totalPages = Math.max(1, Math.ceil(items.length / limit));
  return {
    items: items.slice((page - 1) * limit, page * limit),
    total: items.length,
    page,
    limit,
    totalPages,
    hasNext: page < totalPages,
    date: query.date ?? null,
  };
}
