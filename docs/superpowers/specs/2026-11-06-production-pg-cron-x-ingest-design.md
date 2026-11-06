# Production Postgres + Cron + X Ingest Design

Date: 2026-11-06 (Asia/Tokyo). User-confirmed scope: independent Postgres, wire existing daily collect into startup, loopback :3100 + Nginx HTTPS, plus SSH CLI ingest for X posts (no X API on server).

## Goals

1. Production process refuses in-memory storage; requires `DATABASE_URL`, applies idempotent schema, injects Postgres repository, registers `registerDailyCollect` (08:00 `Asia/Shanghai` per existing `schedule.ts`), stops cron and closes pool on SIGTERM/SIGINT.
2. `/api/health` reports real DB readiness (`ping`) and `storage: "postgres"|"memory"`. Memory must never look like a healthy production database.
3. New source value `x` (additive enum). X items arrive only via internal CLI (stdin JSON), never via `api.x.com`, scraping, or OAuth. Parent/Grok Bot public X tools collect; server only stores.
4. Deploy as isolated Docker Compose project (own network/volume). Backend publishes `127.0.0.1:3100` only. Independent of nubang/umami DBs.

## Non-goals

- Miniapp UI redesign, LLM key bootstrap from other services, public authenticated HTTP ingest (CLI preferred), force-merge of PR, touching airport certs.

## Storage / schema

- Reuse `apps/server/src/app/news-schema.ts` idempotent DDL at startup.
- Additive: `source_enum` value `x`; nullable `metadata jsonb` on `news_items` for `authorHandle`, `authorDisplayName`, and optional extras. Existing columns: `external_id`=post id, `url`, `title`, `raw_excerpt`=original text, `summary`/`summary_status`/`category`.
- Title soft-dedup and URL/`external_id` hard-dedup unchanged; X dedup keys on post id + normalized URL.

## Bootstrap

Env (names only): `HOST`, `PORT`, `CORS_ORIGINS`, `CRON_SECRET`, `DATABASE_URL`, `AI_NEWS_STORAGE` (`memory`|`postgres`), `LLM_*` optional.

Rules:
- `AI_NEWS_STORAGE=postgres` or `NODE_ENV=production` → require non-empty `DATABASE_URL`, create pool, `applySchema`, `PostgresNewsRepository`, `setNewsRepository`, register cron calling the same collect executor as HTTP (errors logged, process stays up). Missing DB URL → hard fail before listen.
- Otherwise default memory for local/tests.

## X ingest CLI

- Entry: `apps/server/scripts/ingest-x.mjs` (or `node dist` equivalent) reading one JSON document from stdin.
- Validates batch size, field lengths, URL host allow-list (`x.com` / `twitter.com` variants), required author fields from payload (no fabrication).
- Inserts via repository with `source: "x"`; receipt `{ inserted, skipped, errors[] }` — no secrets.
- Ops doc on server: `/home/ubuntu/ai-news-deploy/README-x-ingest.md` (and mirrored under `docs/` in repo). Invocation: `docker exec -i … node …/ingest-x.mjs < file.json` over SSH. No HTTP ingest in v1.

## Deploy sketch

- `Dockerfile` (node:24-bookworm-slim) builds server bundle; runtime `--env-file` private file mode 600 under `/home/ubuntu/ai-news-deploy/`.
- Compose services: `db` (postgres:17-alpine, no host ports), `api` (3100→127.0.0.1:3100).
- Nginx site from existing template after local health checks.

## Testing

TDD unit tests: production refuses memory; bootstrap injects/closes; cron register/stop; health distinguishes storage; X validator + ingest receipt; existing suite remains green. Integration on deploy: real collect and/or X file ingest, restart persistence.
