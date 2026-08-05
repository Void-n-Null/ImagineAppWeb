# <img src="./public/icon-192.png" width="36" height="36" align="center"> Imagine App

A web-based AI shopping assistant for Best Buy products, running live at [imagineapp.net](https://imagineapp.net). It searches, compares, and explains products conversationally through an agent loop over Best Buy's public APIs.

## Portfolio discussion
[https://werlinger.dev/projects/imagineapp](https://werlinger.dev/projects/imagineapp)

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
