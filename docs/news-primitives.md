# 纯函数基础设施（枚举 / 日期 / 去重）

一期共享的纯函数模块：无 IO、无环境变量、可单测，供采集编排、查询接口与页面共用。

| 模块 | 内容 |
| --- | --- |
| `src/app/news-types.ts` | 领域枚举常量与 DTO（`source`/`category`/`summary_status`/`run_status`/`source_run_status`/`run_trigger`）、错误码集合与守卫函数 |
| `src/app/news-constants.ts` | 5 类分类字典（`value`/`label`/`order`，`GET /api/categories` 唯一真源）、分页与摘要边界、去重阈值 |
| `src/app/news-date.ts` | `isIsoDate`、`shanghaiDayRangeUtc`（Asia/Shanghai 自然日 → `[startUtc, endUtc)`）、`toShanghaiDateString`、`shanghaiToday` |
| `src/app/news-dedup.ts` | `normalizeUrl`、`normalizeTitle`、`titleFingerprint`、`titleSimilarity`、`isSimilarTitle`、`isDuplicateOf` |

约定：

- 枚举只加不删不改名；未知值降级为原值文本（`categoryLabel` / `sourceLabel`），不报错、不隐藏条目。
- 分类无法判定时兜底 `industry_news`（`coerceCategory`），保证入库 `category` 命中率 100%。
- 日期参数非法直接抛错（接口层映射 `400 INVALID_DATE`），不做静默纠正；`date` 按上海自然日换算为 UTC 半开区间。
- 去重：URL 归一化后相等为硬重复；标题相似度（字符二元组 Dice 系数）严格大于 `0.9`（`TITLE_SIMILARITY_THRESHOLD`）为软重复，指纹仅用于收窄候选。

测试：`tests/news-primitives.part1.test.ts`、`tests/news-dedup.part1.test.ts`。
