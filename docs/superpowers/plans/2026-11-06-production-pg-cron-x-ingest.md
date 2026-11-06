# Production PG + Cron + X Ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline; no subagents in this run).

**Goal:** Wire production Postgres + daily cron startup and SSH X ingest CLI, then deploy behind news.hhrdxmd.com.

**Architecture:** Bootstrap module chooses memory vs postgres; PostgresNewsRepository implements NewsRepository+ping; server.ts starts after bootstrap; X CLI validates JSON and inserts with source=x; Docker Compose isolates DB/API.

**Tech Stack:** Node 24, pg, node-cron, Docker postgres:17, nginx.

## Global Constraints

- Never read/print secrets or foreign .env files.
- No api.x.com / X keys on server.
- Additive schema only on new DB.
- Do not merge PR; one feature branch push + PR.
- Cron timezone: existing Asia/Shanghai 08:00.

---

### Task 1: Contracts + schema additive `x` + metadata

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/server/src/app/news-schema.ts` (enum + metadata column)
- Modify: `apps/server/src/lib/db/ddl.ts` (keep aligned for tests that read DDL_STATEMENTS loosely — prefer schema module for runtime)
- Test: extend schema / contracts tests

### Task 2: PostgresNewsRepository + bootstrap + health

**Files:**
- Create: `apps/server/src/lib/db/postgres-repository.ts`
- Create: `apps/server/src/lib/bootstrap.ts`
- Modify: `apps/server/src/server.ts`, `apps/server/src/api/health/route.ts`, `apps/server/src/lib/db/repository.ts` (optional ping on interface)
- Test: `apps/server/tests/bootstrap.production.test.ts`, `health.storage.test.ts`, `postgres-repository.test.ts` (mocked db)

### Task 3: X ingest validate + CLI

**Files:**
- Create: `apps/server/src/lib/x-ingest.ts`
- Create: `apps/server/scripts/ingest-x.mjs`
- Create: `docs/x-ingest.md`
- Test: `apps/server/tests/x-ingest.test.ts`

### Task 4: Docker deploy assets in repo

**Files:**
- Create: `apps/server/Dockerfile`, `deploy/compose.yaml` (or document only under server deploy dir)
- README snippets

### Task 5: Verify typecheck/test/build; push PR; deploy on server

