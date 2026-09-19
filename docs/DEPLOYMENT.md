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
options below — never with `npx wrangler deploy` alone.

> **A deployed Worker is not a migrated database.** The most common live-site
> failure is `503 STORAGE_UNAVAILABLE` — *"The platform database is not
> initialised yet, so accounts cannot be created or read"*. The upload
> succeeded, but the remote D1 database never had the migrations applied, so it
> has no `users` table. Run `npx wrangler d1 migrations apply DB --remote`, then
> redeploy or use Option D below, which does both in the right order.

## Option A — GitHub Actions (migrations + deploy on every push)

`deploy/github-actions-deploy.yml` runs the full pipeline on each push to
`main`: typecheck → lint → unit tests → `wrangler d1 migrations apply DB
--remote` → build → `wrangler deploy` → a `/api/health` smoke test that fails
the run when the deployment cannot read its database.

**Activate it by copying the file to `.github/workflows/deploy.yml`** (GitHub
UI: *Add file → Create new file*, paste, commit). It ships outside `.github/`
because the GitHub App used by this workspace is not granted the `workflows`
permission, and a commit that creates or edits a workflow file is rejected on
push with *"refusing to allow a GitHub App to create or update workflow"*.

Add two repository secrets (**Settings → Secrets and variables → Actions**):

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | API token with **Workers Scripts: Edit** and **D1: Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | the account id from the Cloudflare dashboard URL |

The database name and id are read from `wrangler.jsonc`; nothing is duplicated
in the workflow. Trigger it manually with **Actions → Deploy to Cloudflare → Run
workflow** after adding the secrets.

## Option B — Cloudflare dashboard (Workers Builds)

In the Worker → Settings → Build configuration:

| Setting         | Value              |
| --------------- | ------------------ |
| Build command   | `npm run build`    |
| Deploy command  | `npx wrangler deploy` |

`npm run build` typechecks the Worker, client and scripts, then runs
`vite build`, which emits the SPA into `dist/client`.

## Option C — single deploy command

If the dashboard only offers one command field, use the repo script that
builds first:

```text
npm run deploy
```

`deploy` is defined as `npm run build && wrangler deploy`.

## Option D — deploy from your machine

```bash
npm ci
npx wrangler d1 migrations apply DB --remote   # required if the database is new
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

## Troubleshooting

### `POST /api/auth/register` (or `/api/auth/status`) returns 500

```text
{"error":{"code":"INTERNAL","message":"Something went wrong. Please try again.",
          "details":{"requestId":"req_..."}}}
```

This is almost always the remote D1 database having **no tables**: the Worker was
deployed but step 2 of the first-time setup (`wrangler d1 migrations apply DB
--remote`) never ran, so the very first query fails with

```text
D1_ERROR: no such table: rate_limit_counters: SQLITE_ERROR
```

Confirm it in one request — the health probe reports the schema state:

```bash
curl https://ielts.ankb.qzz.io/api/health
# {"ok":true,...,"database":{"reachable":true,"schemaReady":true,"missingTables":[]}}
```

`schemaReady: false` with a list of `missingTables` is the diagnosis.

**The Worker now repairs this itself.** On the first request of each isolate it
checks the core tables and creates any that are missing from an idempotent copy
of the final schema (`src/worker/lib/runtime-schema.sql`, generated by
`npm run schema:generate` from `migrations/`). Nothing that already exists is
altered or dropped, so it is also safe on a healthy database. The bootstrap logs
one `schema_bootstrap missing tables: ...` line in Workers → Logs when it fires.

Because the repair is in the deployed bundle, the fix for a live site is simply
**redeploy** (`npm run deploy`, or let Workers Builds run `npm run build` +
`npx wrangler deploy`). Afterwards, applying migrations is still the
recommended way to keep `d1_migrations` bookkeeping accurate:

```bash
npx wrangler d1 migrations apply DB --remote
```

Two admin endpoints expose the same information for an operator who is already
signed in: `GET /api/admin/system/schema` and `POST /api/admin/system/schema/repair`.

### `APP_ENV` and error verbosity

`APP_ENV` in `wrangler.jsonc` is currently `development`, which makes unexpected
server errors include the underlying reason in the JSON response — useful while
the platform is being stood up. Set it to `production` before opening the site
to real candidates:

```jsonc
"vars": { "APP_ENV": "production" }
```
