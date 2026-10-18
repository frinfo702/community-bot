---
title: Architecture
group: Start
order: 2
description: The Worker, the Durable Objects, the SQLite schema, and the two nightly schedules.
---

# Architecture

The whole system is one Worker, five Durable Objects, three API clients, and a container that only wakes up when a task needs it. This page maps what each piece owns and where the seams are.

## The edge

Every Discord event arrives at a single Worker route. The Gateway Durable Object holds the WebSocket to Discord and forwards events as HTTP requests, so the rest of the system never touches a gateway connection directly.

| Route | Method | Purpose |
| --- | --- | --- |
| `/` | `GET` | Health string. Returns `community-bot`. |
| `/webhook` | `POST` | Gateway events. Authenticated with `x-discord-gateway-token`. |
| `/interactions` | `POST` | Slash commands from Discord. Authenticated with the Ed25519 signature (`DISCORD_PUBLIC_KEY`); replies are ephemeral. |
| `/commands/register` | `POST` | Register the slash commands with Discord. Admin secret required. |
| `/connect` | `POST` | Start the Gateway connection. Admin secret required. |
| `/disconnect` | `POST` | Stop the Gateway connection. Admin secret required. |
| `/status` | `GET` | Gateway connection status. Admin secret required. |
| `/probe` | `POST` | Run the 20 persona probes. Admin secret required. |
| `/memory/rollback` | `POST` | Undo one nightly memory run. Admin secret required. |

The webhook returns quickly. Message handling continues in `ctx.waitUntil`, so Discord does not wait on a model call. The only work that blocks the response is de-duplication and the decision to accept the event.

## Durable Objects

| Binding | Class | Instance | Responsibility |
| --- | --- | --- | --- |
| `DISCORD_GATEWAY` | `GatewayDO` | `default` | Holds the Discord Gateway WebSocket and forwards events to `/webhook`. Extends the upstream `discord-gateway-cloudflare-do` class, with `connect()` re-exposed as `start()` because `connect` is reserved on Durable Object stubs. |
| `DEDUPE` | `DedupeDO` | `messages` | A seven-day ledger of message IDs. Gateway resumes can replay events; this makes a replay a no-op. |
| `CONVERSATION` | `ConversationDO` | `log` | The channel log, memories, signals, style revisions, nightly runs, and the nightly alarm. A single instance keeps the log and its memories in one SQLite database. |
| `TASK_AGENT` | `TaskAgent` | one per channel | A Cloudflare Agents SDK agent (`Think`) that runs one multi-step task turn with web search, page reading, and shell tools. |
| `SANDBOX` | `SandboxContainer` | one per channel | Runs one shell command for the task agent, started on demand and stopped after five minutes of inactivity. |

`ConversationDO` is the only shared state in the text reply path. That is deliberate: extraction, nightly consolidation, and the memory commands all read or write the same rows, and a single object gives them one transaction boundary. The task agent keeps its own conversation history per channel; it reads the channel log only through the prompt it receives.

## The SQLite schema

| Table | What it holds |
| --- | --- |
| `messages` | Every non-bot and bot message, with channel, author, content, and timestamp. Indexed by `(channel_id, created_at)`. |
| `memories` | One row per fact about a person. Indexed by `(user_id, updated_at)`. |
| `memory_log` | Read and write ledger. `before` / `after` JSON, actor, reason, and timestamp. |
| `signals` | Reactions on bot messages and corrections of bot messages. Unique per `(message_id, user_id, kind, value)`. |
| `style_revisions` | Proposed style layers, their probe scores, and whether they were applied. |
| `reply_rejections` | Generations the reply gates withheld before posting: the gate, the reason, and the text. |
| `nightly_runs` | One row per consolidation: day, diary, change summary, timestamps, and a rolled-back flag. |

Two tables are present but not load-bearing today: `summaries` is read by the reply context if a row exists, but nothing writes one yet; `episodes` is reserved. They are noted here so a reader does not mistake them for an active feature.

## The model and tool boundary

The bot uses three external services with different jobs.

**Vercel AI Gateway** is OpenAI-compatible and generates text: the chat reply, the memory text, the diary line, and the style proposal. Model IDs live in `src/models.ts` and can be overridden with `CHAT_MODEL` and `DECIDE_MODEL`. Chat calls default to a 30-second timeout. Images attached to the message that triggered a reply are passed to the same chat call as `image_url` content parts (`src/prompt.ts`), so the chat model has to accept image input.

**Jev** is a decision model. It never writes prose. `JevClient` asks for one of three typed answers over `POST /systemone`:

| Type | Answer | Used for |
| --- | --- | --- |
| `choice` | One of a fixed set of options | Stamp emoji, memory verdict, decay, persona judgement |
| `noul` | A probability between 0 and 1 | Emoji-only reply, complex task, quoting the answer, worth remembering, add a memory, correction, reply repeating the preceding turn |
| `score` | A number | Available in the client; not used in the current flows |

**Jina** provides the task agent's web tools: Search for `web_search` and Reader for `read_page`. Each result is capped at 8,000 characters and each call has a 30-second timeout. The endpoints are overridable with `JINA_SEARCH_URL` and `JINA_READER_URL`.

A failed call is a normal branch, not an exception. Each caller decides what to do without it: reply with text, use the default stamp, skip the reaction, record no correction, or leave memories untouched.

## The task agent

When Jev says the request is a complex task, the Worker hands it to `TaskAgent` instead of the chat model.

- The agent is a `Think` object from the Cloudflare Agents SDK, one session per channel. `buildTaskPrompt` gives it the last ten lines of the channel and the request, including who asked.
- The persona core and the active style layer are re-injected on every turn through the `beforeTurn` hook, the same way the text path does it.
- The agent can call three tools:

| Tool | Backend | Limits |
| --- | --- | --- |
| `web_search` | Jina Search | 30-second timeout, 8,000 characters per result |
| `read_page` | Jina Reader | HTTP(S) only, 30-second timeout, 8,000 characters |
| `run_command` | The channel's sandbox container | `bash -lc`, 60-second timeout, last 4,000 characters of output kept |

The container starts on demand with internet access and stops after five minutes of inactivity. The model chooses the commands; the container holds no credentials. `/workspace` keeps files for as long as the container runs, and each channel has its own agent and container.

When the turn completes, the agent's text is posted as one Discord message. The turn runs inside the channel's agent DO, which posts the answer itself: a task turn regularly takes longer than the 30 seconds the webhook's `waitUntil()` allows, so the DO (kept alive by its own `waitUntil()`, up to 15 minutes) owns the reply. If the turn fails or returns no text, the normal text reply runs instead.

Two things make a task feel like a conversation rather than a wait.

- The webhook posts a short acknowledgment before it dispatches the turn: a silent message quoting the request, one short line the model writes in the bot's own voice (persona + active style, with a fixed fallback line). The answer follows as its own message, the way a member answers after saying they will look into it. If the acknowledgment cannot be posted, the task still runs and only the acknowledgment is missing.
- The normal text reply may arrive as two messages. The model separates them with a line containing only `===` when a request invites a long answer; the first message is a short lead-in and the second carries the answer. Every part is logged as its own bot message, numbered in order, so the next turn sees the whole reply and the count stays honest under the 20-message context window.

## Scheduled work

There are two nightly jobs, and they are intentionally not the same mechanism.

| Time | Trigger | Job |
| --- | --- | --- |
| `17:00 UTC` | Worker Cron Trigger (`0 17 * * *`) | Style revision. Reads recent signals, proposes a new style layer, and applies it only if the persona probes do not worsen. |
| `18:00 UTC` / `03:00 JST` | Durable Object alarm | Memory consolidation. Groups the previous day by speaker, extracts and merges memories, reviews stale ones, and writes a diary line. |

The alarm is rescheduled in a `finally` block, so a failed run still schedules the next night. The Cron job is independent; a failure in one does not move the other.

## Deployment topology

There are two Workers in this repository, with separate deploy paths and separate lifecycles.

| | Server | Docs |
| --- | --- | --- |
| Worker | `community-bot` | `community-bot-docs` |
| Definition | `wrangler.jsonc` | `terraform/` |
| Content | TypeScript in `src/` | Static files built from `doc/` |
| Workflow | `.github/workflows/ci.yml` | `.github/workflows/docs.yml` |
| Secrets | Discord, AI Gateway, Jev, Jina | None |

The docs Worker is assets-only. It has no Durable Objects, no bindings, and no runtime secrets, so a docs deploy cannot affect the bot. See [Deploy and operate](operations.md) for the build and apply steps.

## Failure posture

| Failure | What happens |
| --- | --- |
| Gateway webhook secret mismatch | `401`, no processing. |
| Duplicate message ID | `duplicate`, no processing. |
| Jev unavailable | Emoji-only falls back to a written reply, stamp to `👍`, complex task to a written reply, quote decision to quoting, correction to "not a correction", memory extraction writes nothing, reply review to posting the reply as written. |
| Reaction fails | Logged. The reaction is an acknowledgment; a missing one does not cost the written reply or the task. |
| AI Gateway chat failure | The error is logged; that message gets no reply. |
| Reply review retry fails | Logged; the reply is posted with the repeated lines cut out. |
| Task acknowledgment generation fails | The fixed fallback line is posted instead. |
| Task acknowledgment cannot be posted | Logged; the task still runs and posts its answer. |
| Task agent failure or empty answer | The agent posts the normal written reply instead. |
| Task turn slower than the webhook's `waitUntil()` (30 seconds) | The agent keeps running and posts the answer itself; only the webhook stops waiting. |
| Memory extraction failure | The reply has already been sent; the failure is logged and the next turn is unaffected. |
| Nightly consolidation failure | Logged; the next alarm is still scheduled. |
| Nightly rollback of a changed record | The record is skipped, so newer extraction or a user command is not clobbered. |

The guiding rule is that optional work must not take down the reply. A reply may be missing when the chat model itself fails, but a reaction, memory, probe, or task failure does not remove a reply that was already produced.
