# <img src="./public/icon-192.png" width="36" height="36" align="center"> Imagine App

A web-based AI shopping assistant for Best Buy products, running live at [imagineapp.net](https://imagineapp.net). It searches, compares, and explains products conversationally through an agent loop over Best Buy's public APIs.

I work as a sales associate at Best Buy, and a surprising amount of the job is answering questions like "which of these three TVs handles a bright room" with a customer standing there while you page through spec sheets across several screens. In 2025 I built [the first Imagine App](https://github.com/Void-n-Null/Imagine-App) as a Flutter Android app to deal with this, and it worked well enough that I kept using it on shift. This repository is the 2026 rewrite: a hosted web app with accounts, metered usage, and a credit ledger, because I kept wanting the assistant on whatever device happened to be in my hand, and a web app follows you around in a way an APK does not.

I still use it on the floor most shifts.

## What's inside

- **An agent loop:** a model-agnostic runner over the OpenRouter API with a tool registry, streamed tool calls, abort propagation, an iteration cap, and per-turn usage metering into an append-only credit ledger.
- **Tools** for product search, spec analysis, side-by-side comparison, store availability, cart building, and web search, all over Best Buy's public Products API.
- **Barcode scanning:** the agent can request a scan mid-conversation, your camera opens, and the UPC lands back in the thread as a tool result.
- **Streaming UI:** responses arrive over SSE with visible tool traces and tappable product cards. Threads persist in IndexedDB and sync to your account.
- **72-hour transcript retention** on the server, and zero-data-retention routing on every model request. Both started as Best Buy API terms requirements and turned out to be a reasonable [privacy policy](https://imagineapp.net/privacy) on their own.

## Scanning, beyond barcodes

The scanner got more attention than any other part of v2. It reads every common symbology plus Best Buy's own QR codes, and a mode toggle decides what a scan does: open the product page, drop it into the chat, or queue it up for a comparison.

My favorite feature in the app is the local OCR fallback. On the floor you regularly end up holding nothing but an SKU number: the customer's phone is showing one in the Best Buy app, or the POS is, and neither surface gives you a barcode to scan. The main internal stock service does not show the UPC either. So the scanner also runs Tesseract on-device against whatever digits are in view, and anything that pattern-matches an SKU or UPC gets registered as if it had come off a barcode. Point the camera at a number on a monitor or a fact tag and the product comes up. It costs zero API calls because the image never leaves the device, and it genuinely makes v2 feel like something built from the lessons v1 taught me.

It works in the other direction too: the cart can render its contents as a carousel of real UPC-A barcodes, so a register can scan products straight off your screen.

## Free usage, and why

v1 was bring-your-own-key: you connected your own OpenRouter account through OAuth and paid for your own tokens. What v1 taught me, clearly, is that absolutely no one will use AI if step one is creating an account and putting money into credits on a platform they do not understand. In retrospect it's obvious.

So v2 flips it. I put $25 into a private OpenRouter account, and the first 50 users each get $0.50 of usage on signup, with the ability to reach out to me if they want more. OpenRouter reports the exact billed cost of every generation, so metering is accurate to a fraction of a cent: every model call, voice transcription, and web search lands as a row in an append-only USD ledger, and the app cuts you off at the right time. $0.50 was chosen as a good middle between the number of users who get free AI and the number of questions each user gets to ask. On the default model that comes out to roughly 180 questions, which at floor pace is weeks of use. Nothing is sold; there is no payments code to find in here.

## Best Buy Bench

Once the agentic flow was working I needed to pick a default model I could afford to hand out for free, so I built a synthetic benchmark and used it to find the best cost-to-quality ratio: 53 objective questions across search, comparison, and spec-reading tasks, run through the real production agent stack, graded against the live catalog by SKU and fact checks rather than an LLM judge. That run is what made me confident enough to fund the pool, and it picked Gemini 3.1 Flash Lite as the default (87% pass rate at $0.003 a question). The whole scoreboard is public at [imagineapp.net/bestbuybench](https://imagineapp.net/bestbuybench), with per-task breakdowns, cost plotted against score, and the methodology and limitations on the page itself. The numbers are a static snapshot and only change with a dated re-run. A few well-known models landed in the unusable bucket.

## How it's built

- **TanStack Start** (React, file-based routes, server functions), TypeScript throughout
- **Neon Postgres + Drizzle** for users, the credit ledger, settings, and the short-lived chat transcripts
- **Clerk** for auth, **Upstash Redis** for rate limiting and the Best Buy proxy cache, **PostHog** for analytics
- **Bun, Biome, Vitest**, plus e2e tests

## Running it yourself

```bash
bun install
cp .env.example .env   # fill in the blanks
bun run db:migrate
bun run dev
```

You will need your own keys: Best Buy developer API, OpenRouter, Clerk, and Postgres, with Redis and PostHog optional. Two things to know before self-hosting: rate limiting is skipped entirely when Redis is not configured, and interrupted streams do not resume, you just retry the turn. This is the code I run in production, published so it can be read and learned from rather than as a turnkey template.

`bun run check` runs typecheck, lint, and tests.

## Lineage

- **v1:** [Imagine-App](https://github.com/Void-n-Null/Imagine-App) (2025). Flutter, OpenRouter OAuth PKCE, bring-your-own-key.
- **v2:** this repository (2026). Web, hosted, accounts and credits instead of BYOK.

Imagine App is a personal project and is not affiliated with, endorsed by, or supported by Best Buy. Product data comes from Best Buy's publicly available APIs, used with attribution per their [developer program](https://developer.bestbuy.com/) branding guidelines. Best Buy and the Best Buy logo are trademarks of Best Buy and its affiliated companies.

## License

[AGPL-3.0](./LICENSE). If you run a modified copy as a service, share your changes.
