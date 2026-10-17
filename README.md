# community-bot

An AI bot living in a 4-person Discord server. All infrastructure runs on Cloudflare; there is no always-on machine.

- The Gateway connection uses [discord-gateway-cloudflare-do](https://github.com/dcartertwo/discord-gateway-cloudflare-do) (a Durable Object holds the Discord Gateway WebSocket and forwards events to the Worker)
- Models come from the Vercel AI Gateway (OpenAI-compatible)
- Flow:
  Discord → Gateway DO → `POST /webhook` → store the conversation log in DO SQLite → detect mentions → generate with the AI Gateway (with recent context) → post via Discord REST. For task decisions, the Cloudflare Agents SDK agent (TaskAgent) researches and answers

## Requirements

- Node.js 20+
- A Cloudflare account (Workers Paid plan; needed for Durable Objects and the always-connected Gateway)
- A Discord app (creation steps in docs/discord-setup.md)
- A Vercel AI Gateway API key and the model IDs you use
- A Jina API key (web_search / read_page for the task agent)

## Setup

```bash
npm install
cp .dev.vars.example .dev.vars   # for local development

npx wrangler login
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put DISCORD_APPLICATION_ID
npx wrangler secret put DISCORD_GATEWAY_SECRET   # any random string
npx wrangler secret put ADMIN_SECRET             # any random string
npx wrangler secret put AI_GATEWAY_API_KEY
npx wrangler secret put JEV_API_KEY
npx wrangler secret put JINA_API_KEY

npm run deploy
```

Deploy the first time from your machine like this. After that, pushes to main are deployed by GitHub Actions (see CI/CD below).

Verify the deployment and connect the Gateway:

```bash
curl -X POST https://community-bot.<subdomain>.workers.dev/connect \
  -H "x-admin-secret: $ADMIN_SECRET"

curl -H "x-admin-secret: $ADMIN_SECRET" \
  https://community-bot.<subdomain>.workers.dev/status
```

You are done when `/status` returns `{"status":"connected", ...}`. Mention the bot in the server and it replies.

You can measure whether the persona holds with the persona probes (20 prompts mixing jokes, genuine distress, and character-break requests; the Jev judge counts sermons and shifts as deviations and returns the deviation rate).

```bash
curl -X POST https://community-bot.<subdomain>.workers.dev/probe \
  -H "x-admin-secret: $ADMIN_SECRET"
```

## Environment variables

| Name | Purpose |
| --- | --- |
| `DISCORD_BOT_TOKEN` | Discord bot token |
| `DISCORD_APPLICATION_ID` | Application ID (same as the bot user ID); used for mention detection |
| `DISCORD_GATEWAY_SECRET` | Webhook authentication from the Gateway DO to the Worker |
| `ADMIN_SECRET` | Protects `/connect` `/disconnect` `/status` |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway key |
| `AI_GATEWAY_BASE_URL` | Defaults to `https://ai-gateway.vercel.sh/v1` |
| `JEV_API_KEY` | TypeSafe (Jev) API key |
| `JEV_BASE_URL` | Defaults to `https://api.typesafe.ai/v1` |
| `JINA_API_KEY` | Jina (Search / Reader) API key |
| `JINA_SEARCH_URL` | Defaults to `https://s.jina.ai/` |
| `JINA_READER_URL` | Defaults to `https://r.jina.ai/` |
| `CHAT_MODEL` | Model for conversation; defaults to the one in `src/models.ts` |
| `DECIDE_MODEL` | Model for Jev decisions; defaults to the one in `src/models.ts` |

Register the same names locally in `.dev.vars` and in production with `npx wrangler secret put <NAME>` (optional overrides may stay unregistered). An empty value is treated as unset, so lines you do not use can stay empty. The default model IDs live in `src/models.ts` and can be overridden with `CHAT_MODEL` / `DECIDE_MODEL` in `.dev.vars`.

## CI/CD

- Type checking and tests run on pull requests and pushes to main (`.github/workflows/ci.yml`)
- On pushes to main, `npm run deploy` runs after the tests pass and deploys to Cloudflare automatically
- To redeploy manually, run the `CI/CD` workflow from Actions with `workflow_dispatch`
- The docs site is deployed by a separate workflow (`.github/workflows/docs.yml`) and Worker (`terraform/`) from the server

Register these two repository secrets (Settings → Secrets and variables → Actions).

| Name | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | An API token that can edit Workers; create it from the "Edit Cloudflare Workers" template in the dashboard |
| `CLOUDFLARE_ACCOUNT_ID` | Shown by `npx wrangler whoami` |

Runtime secrets (`DISCORD_BOT_TOKEN` and others) are stored on the Cloudflare side and are not changed by deploys from Actions.

## Docs site

A static site is generated from the Markdown in `doc/`. Architecture, the agent flow, the memory system, and the commands are documented there.

https://community-bot-docs.kenichiro3114.workers.dev

```bash
npm run docs:dev     # preview at http://localhost:4321
npm run docs:build   # output to doc/dist/
```

- The content lives in `doc/*.md` (all in English)
- The design and build live in `doc/site/`
- It is served by the static Worker in `terraform/`, separate from the server Worker
- Changes under `doc/` are built by `.github/workflows/docs.yml`, and main applies Terraform

## Development

```bash
npm run dev        # wrangler dev
npm test           # vitest
npm run typecheck  # tsc --noEmit
npm run deploy     # wrangler deploy
```

The persona is defined in `persona.md`. `core` is maintained by humans; only `style` is subject to self-improvement (ISSUE-1867).

The skills that let the bot know what it can do live in `skills/<name>/SKILL.md` (the frontmatter name and description become the catalog). Adding one also needs a line in `src/skill-files.ts`. The Dockerfile copies the same directory into the sandbox as `/workspace/.agents/skills`, and `sandbox/AGENTS.md` becomes `/workspace/AGENTS.md`.

## What it can do now

- Reply to mentions (with a typing indicator and a reply to the original message)
- Conversation log storage in DO SQLite (per channel) and context-aware replies from the last 20 messages plus a summary (ISSUE-1877)
- Jev client (typed decisions: choice / boolean / score, ISSUE-1878)
- Staged reply decisions by Jev (1: is an emoji alone enough; 2: is it a complex task? Tasks fall back to text, ISSUE-1876)
- Agent execution on task decisions (Cloudflare Agents SDK): `TaskAgent` keeps a per-channel session and answers multi-step work with web_search / read_page (Jina) and run_command (a shell in a container; 60 seconds per command, per-channel working directory). The persona (fixed core + style layer) is re-injected on every turn by the beforeTurn hook (ISSUE-1865). The agent posts its own answer from the DO, because a task turn runs longer than the webhook's 30-second `waitUntil()` window; on failure it posts the normal text reply instead
- Skill catalog (Agent Skills): the frontmatter of `skills/<name>/SKILL.md` feeds the system prompt catalog and `activate_skill` loads a body on demand, so the bot knows what it can do without carrying every detail in the prompt. The same files are copied into the sandbox as `/workspace/.agents/skills` and `/workspace/AGENTS.md`
- Emoji reaction (stamp) replies (ISSUE-1875). When replying with an emoji alone or acknowledging a long task, Jev picks a reaction that fits the conversation. Emoji are chosen from in-code categories (agreement, laughter, sympathy, and others) and the server's custom emoji; the per-category ranking and the custom emoji list are cached in the DO so all candidates are not evaluated every time
- Per-user memory (memories / episodes / memory_log) and speaker profile injection (ISSUE-1872)
- Daytime memory extraction (after a reply, Jev decides add / update / delete; the LLM rewrites only the affected records, and the reason stays in memory_log. ISSUE-1869)
- `!memory show` / `!memory forget` to list and delete your own memories (show sends a DM; deletions are recorded in memory_log; ISSUE-1879)
- Persona probes (20 prompts) and deviation-rate measurement (POST /probe, ISSUE-1880)
- Reaction signal collection (reactions, corrections) and nightly self-revision of the style layer only (ISSUE-1867; runs daily from a Cron Trigger at 17:00 UTC and is applied only when the probe deviation rate does not get worse)
- Nightly memory consolidation (ISSUE-1874; a DO alarm at 03:00 JST daily; Jev consolidates the previous day's log per speaker and the LLM writes the memory texts and a one-line diary. `POST /memory/rollback` (protected by x-admin-secret) rewinds the most recent run)
- Re-injection of persona.md (fixed core + style layer) at the end of every turn (ISSUE-1865)
- Deduplication by message ID
- Gateway connect / disconnect / status

What it cannot do yet (issues are tracked in the Linear community-bot project):

- See Linear for the backlog items
