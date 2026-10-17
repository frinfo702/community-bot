---
title: HTTP API
group: Reference
order: 2
description: The admin endpoints, the gateway webhook, and the response shapes.
---

# HTTP API

The Worker exposes a small HTTP surface for operations, one endpoint for the Discord gateway, and one for slash commands. There is no public API and no user authentication; everything sensitive is protected by a shared secret or a signature.

## Authentication

| Header | Used by | Value |
| --- | --- | --- |
| `x-admin-secret` | `/connect`, `/disconnect`, `/status`, `/probe`, `/memory/rollback`, `/commands/register` | The `ADMIN_SECRET` secret |
| `x-discord-gateway-token` | `/webhook` | The `DISCORD_GATEWAY_SECRET` secret |
| `x-signature-ed25519` + `x-signature-timestamp` | `/interactions` | Signed with the app's private key; checked against `DISCORD_PUBLIC_KEY` |

A missing or wrong header returns `401 unauthorized` for admin routes. The webhook returns the same status for a bad token, and `/interactions` for a signature that does not verify.

## Health

```http
GET /
```

Returns the plain string `community-bot`. It does not touch a Durable Object or a model.

## Connect, disconnect, status

```bash
curl -X POST "https://<worker>.<subdomain>.workers.dev/connect" \
  -H "x-admin-secret: $ADMIN_SECRET"

curl -H "x-admin-secret: $ADMIN_SECRET" \
  "https://<worker>.<subdomain>.workers.dev/status"

curl -X POST "https://<worker>.<subdomain>.workers.dev/disconnect" \
  -H "x-admin-secret: $ADMIN_SECRET"
```

`/connect` starts the Gateway with the bot token, the current origin's `/webhook`, and `DISCORD_GATEWAY_SECRET` as the shared token. A successful start returns the gateway's `{ "status": "connecting" }`. A failure returns `{ "error": "..." }` with status `500`, so a Durable Object exception is readable JSON rather than an HTML error page.

`/status` and `/disconnect` return the payloads from the gateway Durable Object.

## Persona probes

```bash
curl -X POST "https://<worker>.<subdomain>.workers.dev/probe" \
  -H "x-admin-secret: $ADMIN_SECRET"
```

Runs all 20 probes in parallel and returns a report:

```json
{
  "total": 20,
  "judged": 20,
  "deviationRate": 0.1,
  "counts": {
    "kept": 18,
    "sermon": 1,
    "shift": 1,
    "unknown": 0
  },
  "results": [
    {
      "id": "joke-1",
      "category": "joke",
      "judgement": "kept",
      "reply": "..."
    }
  ]
}
```

`judged` excludes `unknown` results. `deviationRate` is `(sermon + shift) / judged`, or `0` when nothing was judged. A failed probe run returns `{ "error": "..." }` with status `500`.

The nightly style revision uses the same function, so a manual probe is a faithful sample of the gate.

## Memory rollback

```bash
# Undo the latest nightly run
curl -X POST "https://<worker>.<subdomain>.workers.dev/memory/rollback" \
  -H "x-admin-secret: $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{}'

# Undo a specific run
curl -X POST "https://<worker>.<subdomain>.workers.dev/memory/rollback" \
  -H "x-admin-secret: $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{ "runId": 12 }'
```

The body is optional; an omitted `runId` targets the latest run. A successful rollback returns:

```json
{
  "runId": 12,
  "day": "2026-10-16",
  "reversed": 4,
  "skipped": 1,
  "alreadyRolledBack": false
}
```

`reversed` counts changes undone. `skipped` counts records that had changed again since the run, so they were left alone. A run that was already rolled back returns the same shape with `alreadyRolledBack: true` and status `409`. An unknown `runId` returns `404` with `{ "error": "nightly run not found" }`.

## Slash commands

```bash
curl -X POST "https://<worker>.<subdomain>.workers.dev/commands/register" \
  -H "x-admin-secret: $ADMIN_SECRET"
```

Registers the commands defined in `src/commands.ts` with `PUT /applications/{id}/commands`, which replaces the whole global list, so it is safe to call after every deploy. It returns `{ "ok": true, "commands": ["memory"] }`.

```http
POST /interactions
x-signature-ed25519: <hex>
x-signature-timestamp: <unix seconds>
```

Discord sends every slash command here, and this URL is the app's Interactions Endpoint URL. The Worker verifies the Ed25519 signature over `<timestamp><body>` against `DISCORD_PUBLIC_KEY` before reading the body; a request that does not verify gets `401` and is otherwise ignored. The endpoint answers the portal's `PING` with `{ "type": 1 }` and a command with an ephemeral callback (`type: 4`, `flags: 64`), so only the member who ran the command sees the reply. Discord wants an answer within three seconds: a memory command is one read or delete on `ConversationDO`, so the reply is sent directly instead of deferring. The gateway library never forwards `INTERACTION_CREATE`, so this is the only path interactions take.

## Gateway webhook

```http
POST /webhook
x-discord-gateway-token: <DISCORD_GATEWAY_SECRET>
```

The Gateway Durable Object sends two event types:

- `GATEWAY_MESSAGE_CREATE`: a message in a channel. Bot authors are ignored. Duplicate IDs are ignored. Accepted events are logged, and a mention continues through the reply pipeline.
- `GATEWAY_MESSAGE_REACTION_ADD`: a reaction. It is recorded only when the target message was authored by the bot and the reactor is not the bot.

Other event types return `ignored`. The endpoint responds `ok`, `duplicate`, `ignored`, or `unauthorized`; the heavy work continues in `ctx.waitUntil`.

## Error behavior

| Status | When |
| --- | --- |
| `200` | The request was accepted. Some webhook responses are plain strings rather than JSON. |
| `401` | Missing or wrong secret. |
| `404` | Unknown path, or an unknown nightly run for rollback. |
| `409` | The nightly run was already rolled back. |
| `500` | A Durable Object or model call failed; the body is `{ "error": "..." }` where the route catches it. |

There is no rate limiting at the Worker. Discord's own API rate limits are handled in `DiscordClient` with up to three retries on `429`, using Discord's `retry_after` value.
