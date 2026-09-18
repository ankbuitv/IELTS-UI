# Deployment — Ai eo on Cloudflare Workers

One Worker serves the API (`/api/*`) and the built React SPA from
`dist/client` (see the `assets` block in `wrangler.jsonc`). The client **must
be built before** `wrangler deploy` runs, otherwise the deploy fails with:

```text
✘ [ERROR] The directory specified by the "assets.directory" field in your
configuration file does not exist:
  /opt/buildhome/repo/dist/client
```

That error always means the build step was skipped. Fix it with one of the
two configurations below — never with `npx wrangler deploy` alone.

## Option A — Cloudflare dashboard (Workers Builds, recommended)

In the Worker → Settings → Build configuration:

| Setting         | Value              |
| --------------- | ------------------ |
| Build command   | `npm run build`    |
| Deploy command  | `npx wrangler deploy` |

`npm run build` typechecks the Worker, client and scripts, then runs
`vite build`, which emits the SPA into `dist/client`.

## Option B — single deploy command

If the dashboard only offers one command field, use the repo script that
builds first:

```text
npm run deploy
```

`deploy` is defined as `npm run build && wrangler deploy`.

## Option C — deploy from your machine

```bash
npm ci
npm run deploy
```

## First-time setup (one-off)

```bash
# 1. Bindings
npx wrangler d1 create ielts-platform-db          # copy the id into wrangler.jsonc
npx wrangler queues create ielts-import-jobs      # optional: the import queue
npx wrangler queues create ielts-import-jobs-dlq

# 2. Database
npx wrangler d1 migrations apply DB --remote
npx wrangler d1 execute DB --remote --file=./seed/seed.sql   # optional sample content

# 3. Secrets (server-side only; never committed)
npx wrangler secret put SESSION_SECRET      # required
npx wrangler secret put OPENAI_API_KEY      # optional: enables AI structuring

# 4. Deploy
npm run deploy
```

Notes:

- `APP_BASE_URL` in `wrangler.jsonc` must match the deployed origin: it is
  used for the same-origin check, absolute links and cookie attributes.
- `wrangler.jsonc` declares `custom_domain = ielts.ankb.qzz.io`. That zone
  must be on the Cloudflare account running the deploy; otherwise remove the
  `routes` block and add the domain in the dashboard instead.
- `dist/` is git-ignored on purpose — the build always runs in CI or just
  before deploy, so a stale bundle can never be shipped by accident.
