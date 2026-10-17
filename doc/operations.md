---
title: Deploy and operate
group: Operations
order: 1
description: Local setup, secrets, the two deploy paths, and the docs pipeline.
---

# Deploy and operate

There are two deploy paths. The bot deploys from `wrangler.jsonc` after tests pass. The docs site builds from Markdown and deploys through a separate Terraform Worker. Neither path can deploy the other.

## What you need

- Node.js 20 or newer.
- A Cloudflare account on the Workers Paid plan. Durable Objects and the sandbox container need it.
- A Discord application, a bot token, and the application ID.
- The app's public key, for the slash command endpoint.
- A Vercel AI Gateway key, a TypeSafe Jev key, and a Jina key (for the task agent's search and reader tools).

## Secrets

Runtime secrets live in Cloudflare, not in the repository. The GitHub Actions deploy does not change them.

| Name | Purpose |
| --- | --- |
| `DISCORD_BOT_TOKEN` | Discord bot token. |
| `DISCORD_APPLICATION_ID` | Application ID, also the bot's user ID. Used for mention detection. |
| `DISCORD_PUBLIC_KEY` | The app's public key. Verifies the Ed25519 signature on `/interactions`. |
| `DISCORD_GATEWAY_SECRET` | Shared secret between the Gateway Durable Object and `/webhook`. |
| `ADMIN_SECRET` | Protects `/connect`, `/disconnect`, `/status`, `/probe`, `/memory/rollback`, `/commands/register`. |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway key. |
| `AI_GATEWAY_BASE_URL` | Optional. Defaults to `https://ai-gateway.vercel.sh/v1`. |
| `JEV_API_KEY` | TypeSafe Jev key. |
| `JEV_BASE_URL` | Optional. Defaults to `https://api.typesafe.ai/v1`. |
| `JINA_API_KEY` | Jina key for the task agent's `web_search` and `read_page` tools. |
| `JINA_SEARCH_URL` | Optional. Defaults to `https://s.jina.ai/`. |
| `JINA_READER_URL` | Optional. Defaults to `https://r.jina.ai/`. |
| `CHAT_MODEL` | Optional. Overrides the chat model from `src/models.ts`. |
| `DECIDE_MODEL` | Optional. Overrides the Jev model from `src/models.ts`. |

Model IDs are not secrets. The defaults live in `src/models.ts`, and `CHAT_MODEL` / `DECIDE_MODEL` can override them without a code change. An empty value counts as "not set".

The repository's Actions secrets are only:

| Name | Purpose |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Token with Workers Scripts edit permission. |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID used by Wrangler and Terraform. |

## Run locally

```bash
npm install
cp .dev.vars.example .dev.vars
npx wrangler login

npm run dev        # wrangler dev
npm run typecheck  # tsc --noEmit
npm test           # vitest
```

The test suite covers the prompt assembly, reply decisions, the task turn, Jina clients, memory extraction, nightly consolidation, commands, signals, and the Discord client. Nothing in the test suite calls Discord, AI Gateway, Jev, or Jina; those clients accept injected `fetch` functions.

## Deploy the bot

The first deploy is manual, so the secrets exist before the first CI run:

```bash
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put DISCORD_APPLICATION_ID
npx wrangler secret put DISCORD_GATEWAY_SECRET
npx wrangler secret put ADMIN_SECRET
npx wrangler secret put AI_GATEWAY_API_KEY
npx wrangler secret put JEV_API_KEY
npx wrangler secret put JINA_API_KEY

npm run deploy
```

After that, `.github/workflows/ci.yml` runs typecheck and tests on every pull request and every push to `main`. On `main`, a passing test job is followed by `npm run deploy`. The workflow can also be started manually with `workflow_dispatch`.

Connecting the Gateway is a separate step:

```bash
curl -X POST "https://community-bot.<subdomain>.workers.dev/connect" \
  -H "x-admin-secret: $ADMIN_SECRET"

curl -H "x-admin-secret: $ADMIN_SECRET" \
  "https://community-bot.<subdomain>.workers.dev/status"
```

A connected status looks like `{"status":"connected", ...}`.

## The docs site

This site is generated from the Markdown files in `doc/` and served by a static-assets Worker defined in `terraform/`.

### Build

```bash
npm run docs:build   # Markdown -> doc/dist
npm run docs:dev     # build, then serve at http://localhost:4321
npm run docs:serve   # serve the existing doc/dist
```

Every page is a Markdown file with frontmatter:

```md
---
title: Architecture
group: Start
order: 2
description: One sentence for search and the meta tag.
---
```

The build reads the frontmatter, orders the navigation by group and `order`, renders Markdown with GFM tables and fenced code, inlines the diagrams, generates the search index, and writes a `404.html`. It also checks every internal link and heading anchor; a broken link fails the build.

The output is `doc/dist/`. It is generated and ignored by git. The source of the design is in `doc/site/`: `build.mjs`, the ordered CSS partials in `styles/`, `main.js`, fonts, and diagrams. The build concatenates the partials into the single `style.css` the pages load.

Adding a page requires no build configuration. Drop a new `.md` file in `doc/` with the right group, and it appears in the navigation, the pager, and the search index.

### Terraform

`terraform/` defines two resources: the Worker and its workers.dev subdomain.

```hcl
resource "cloudflare_workers_script" "docs" {
  account_id         = var.account_id
  script_name        = var.worker_name
  content            = templatefile("${path.module}/worker.mjs", { html = local.not_found_html })
  main_module        = "worker.mjs"
  compatibility_date = var.compatibility_date
  assets = {
    directory = "${path.module}/../doc/dist"
    config = {
      html_handling = "auto-trailing-slash"
      headers       = file("${path.module}/headers.txt")
    }
  }
}

resource "cloudflare_workers_script_subdomain" "docs" {
  account_id  = var.account_id
  script_name = cloudflare_workers_script.docs.script_name
  enabled     = true
}
```

The Worker template returns the built `404.html` when no asset matches. There are no bindings and no secrets on this Worker.

Run it locally with the account ID:

```bash
cd terraform
terraform init
terraform plan -var "account_id=$CLOUDFLARE_ACCOUNT_ID"
```

The worker name defaults to `community-bot-docs`. Set `worker_name` to change it, or `compatibility_date` if the assets runtime needs a newer date.

The docs deploy has no long-lived Terraform state. Both resources are importable by name. The workflow imports them before applying:

```bash
terraform import -input=false \
  cloudflare_workers_script.docs \
  "$CLOUDFLARE_ACCOUNT_ID/community-bot-docs" || true
terraform import -input=false \
  cloudflare_workers_script_subdomain.docs \
  "$CLOUDFLARE_ACCOUNT_ID/community-bot-docs" || true
terraform apply -input=false -auto-approve
```

The imports fail harmlessly when the resources do not exist yet, and the apply creates them. Keeping the module to these two resources is what makes this safe. If you add DNS records, R2 buckets, or a custom domain, add a remote backend instead of relying on import.

The workflow starts every deploy with an empty state, so the asset manifest is always uploaded. If you run an apply locally after changing the build output, remove `terraform/terraform.tfstate` first; a state file left over from an earlier apply can skip the asset upload.

### CI/CD

`.github/workflows/docs.yml` is separate from the bot workflow.

- On a pull request or a push that touches `doc/**`, `terraform/**`, or the workflow itself, the build job runs `npm run docs:build`, checks Terraform formatting, and validates the configuration.
- On `main`, a passing build job is followed by a deploy job that builds again, initializes Terraform, imports the Worker if it exists, and applies.
- `workflow_dispatch` runs the same path on demand.

The deploy job needs the same `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets as the bot. It does not touch the bot's Worker, secrets, or Durable Objects.

### Custom domain

The deployed site is [community-bot-docs.kenichiro3114.workers.dev](https://community-bot-docs.kenichiro3114.workers.dev). To serve it from a custom domain, add a `cloudflare_workers_custom_domain` resource and a DNS record, and switch the Terraform setup to remote state. The docs build does not assume a hostname; internal links are root-relative.

## Observability

The bot Worker has Workers Logs enabled in `wrangler.jsonc`. The log lines that matter are:

| Log | What it tells you |
| --- | --- |
| `emoji only` | Whether a reaction alone was enough, and the probability |
| `stamp` | The chosen emoji and confidence |
| `correction` | Whether a reply was counted as a correction |
| `complex task` | Whether the task agent was chosen, and the probability |
| `reaction failed` | A reaction could not be added; the written reply or task continues |
| `task executed` | Model, elapsed time, and the length of the answer |
| `memory extraction` | Worth-remembering decision and applied changes |
| `nightly` | Day, message count, change counts, decay count, diary |
| `style revision` | Signal count, applied flag, deviation before and after |
| `persona probe` | Total, judged, deviation rate, and counts |

Stream logs from a terminal with:

```bash
npx wrangler tail community-bot
```

The docs Worker only serves the built `404.html` on a miss. A Terraform apply is the deploy log.

## Recovery

| Symptom | Check |
| --- | --- |
| The bot does not answer mentions | `/status`; reconnect with `/connect`. Check the bot token and `DISCORD_GATEWAY_SECRET`. |
| `/memory` does not appear in Discord | `POST /commands/register`; global commands can take up to an hour. Check that the portal's Interactions Endpoint URL is `<origin>/interactions`. |
| Messages are processed twice | The `DedupeDO` ledger; it keeps seven days. A duplicate after that window is expected. |
| A nightly memory run was wrong | `POST /memory/rollback` with the run ID, or omit it for the latest run. |
| The persona feels off | `POST /probe` and compare the deviation rate with the last `style revision` log. |
| A task fails | Check the `complex task` log and then `task executed`; if the agent fails, the written reply should still arrive. |
| A reaction is missing | Check `reaction failed`; the missing reaction does not block the written reply. |
| The docs deploy fails | Check `npm run docs:build` locally first. Terraform errors usually mean a missing account ID or a token without Workers Scripts edit permission. |
