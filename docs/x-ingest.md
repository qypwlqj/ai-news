# X ingest contract (stable)

X posts are collected off-server by Grok Bot public X tools and imported through an **internal CLI** over SSH (`docker exec -i`). The API server never calls `api.x.com`, never stores X API keys, and does not expose a public ingest HTTP route in v1.

## Stable JSON document (stdin)

```json
{
  "items": [
    {
      "postId": "2118390190246879554",
      "url": "https://x.com/OpenAI/status/2118390190246879554",
      "authorHandle": "OpenAI",
      "authorDisplayName": "OpenAI",
      "publishedAt": "2026-11-05T17:09:13.000Z",
      "text": "original post text",
      "summary": "中文摘要",
      "category": "model_release",
      "title": "optional title"
    }
  ]
}
```

Rules:
- Batch size ≤ 50
- `url` host allow-list: `x.com` / `twitter.com` (+ www/mobile); path `/ {handle} /status/ {postId}`
- `postId` digits; must match URL status id
- `authorHandle` and `authorDisplayName` required from the payload (never fabricated)
- Field max lengths: title 500, text 4000, summary 500, handle 64, display name 128
- Dedup: `external_id=postId` and normalized URL; receipt `{ inserted, skipped, errors }`

Candidate feeds from the parent agent (snake_case) are **not** this contract. Convert with `--candidate` mapping (`post_id`→`postId`, `author.handle`/`name`, `original_text`, `summary_zh`, `title_zh`, topics→category heuristic) before insert.

## Import command (server)

See `/home/ubuntu/ai-news-deploy/README-x-ingest.md` on the host for the exact `docker exec` invocation. Never put secrets in the JSON file or this document.
