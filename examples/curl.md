# 调用示例

令牌由环境变量注入，示例中以 `${CRON_SECRET}` 占位，切勿提交真实值。

## 资讯列表

```bash
# 当日全部（默认 limit=20）
curl -s 'http://127.0.0.1:3000/api/news'

# 指定日期 + 分类 + 第 2 页
curl -s 'http://127.0.0.1:3000/api/news?date=2025-06-01&category=model_release&page=2'

# 非法分类应返回 400 INVALID_CATEGORY
curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:3000/api/news?category=bad'
```

## 采集（外部调度兜底）

```bash
# 全部来源、当日
curl -s -X POST 'http://127.0.0.1:3000/api/cron/collect' \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H 'Content-Type: application/json'

# 指定日期与来源，强制重跑
curl -s -X POST 'http://127.0.0.1:3000/api/cron/collect' \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H 'Content-Type: application/json' \
  -d '{"date":"2025-06-01","sources":["arxiv_cs_ai"],"force":true}'
```

## 日志与探活

```bash
curl -s 'http://127.0.0.1:3000/api/collect-runs?date=2025-06-01'
curl -s 'http://127.0.0.1:3000/api/collect-runs/<runId>'
curl -s 'http://127.0.0.1:3000/api/health'
```
