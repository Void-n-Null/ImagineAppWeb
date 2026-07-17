# ImagineAppWeb — Agent Guide

Imagine App v2: AI shopping assistant for Best Buy products, as a TanStack Start SPA.
v1 (Flutter/Android) lives at https://github.com/Void-n-Null/Imagine-App and is the
reference for anything described as "ported".

## Commands

- Runtime/PM: **bun** (`bun install`, `bun run dev`, `bunx`). No npm/yarn/pnpm.
- `bun run check` — typecheck + lint (Biome) + tests. Run before every commit.
- `bun run test` — Vitest only. e2e lives in `e2e/`.
- `bun run db:generate` / `db:migrate` — Drizzle migrations against `DATABASE_URL`.
- Env: copy `.env.example` to `.env.local`. Secrets are server-only; never
  `VITE_`-prefix a secret, that ships it to the browser.

## Layout

- `src/routes/` — file-based routes; `api.agent.turn.ts` is the SSE agent endpoint.
- `src/features/` — feature slices (chat, agent, scanner, barcode, cart,
  comparison, models, settings, analytics). The agent loop and tool registry
  are in `src/features/agent/`.
- `src/server/` — server functions, Clerk auth seam (`auth.ts`), credit ledger
  (`credits/`), Drizzle schema (`db/schema.ts`).
- `scripts/bench/` — the Best Buy Bench harness. Runs the real agent stack
  standalone under bun with a dev key; see README in that directory.

## Doctrine worth knowing before editing

- The agent turn endpoint is **stateless**: the client sends the transcript
  every turn. Tools that need the device (camera scan) are emitted as
  `client_action` SSE events; the client performs them and re-invokes the turn.
- Money: metering uses OpenRouter's reported billed cost per generation,
  written to an append-only USD ledger. Never estimate from token counts.
- Best Buy API terms drive real constraints: the source mark on every data
  surface, 72-hour server-side transcript retention, and zero-data-retention
  provider routing on all model calls. Do not remove any of these.
- Issue tracking happens in a Lific instance (project IMA); issue ids appear
  in commit messages. External contributors: just describe the change in the PR.
