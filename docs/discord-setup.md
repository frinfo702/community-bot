# Discord app setup

## 1. Create the app

1. Open https://discord.com/developers/applications and create `community-bot` from New Application
2. Note the `APPLICATION ID` under General Information (= `DISCORD_APPLICATION_ID`)

## 2. Enable the bot and set intents

1. Open Bot in the left menu
2. Turn on `MESSAGE CONTENT INTENT` (without it, message bodies arrive empty)
3. Reset the Token and note it as `DISCORD_BOT_TOKEN`

The required intents are GUILDS / GUILD_MESSAGES / MESSAGE_CONTENT / GUILD_MESSAGE_REACTIONS. The regular ones are enabled by default, so MESSAGE CONTENT is the only one to turn on in the portal. A 4-person server does not need privileged intent review.

## 3. Invite it to the server

Open the URL below, replacing `<APP_ID>` with the APPLICATION ID.

```text
https://discord.com/api/oauth2/authorize?client_id=<APP_ID>&scope=bot%20applications.commands&permissions=117824
```

`permissions=117824` is the sum of View Channel / Send Messages / Embed Links / Attach Files / Read Message History / Add Reactions. Add more with Discord's permission calculator if any are missing.

Pick the 4-person server as the installation target.

## 4. Register secrets in Cloudflare

```bash
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put DISCORD_APPLICATION_ID
npx wrangler secret put DISCORD_GATEWAY_SECRET
npx wrangler secret put ADMIN_SECRET
```

`DISCORD_GATEWAY_SECRET` and `ADMIN_SECRET` can be any strings, for example from `openssl rand -hex 32`.

## 5. Connect

```bash
curl -X POST https://community-bot.<subdomain>.workers.dev/connect \
  -H "x-admin-secret: $ADMIN_SECRET"
```

## Memory commands

Members can manage their own per-user memories (ISSUE-1879). These are text commands, not slash commands. The Gateway library (discord-gateway-cloudflare-do) only forwards MESSAGE_CREATE / MESSAGE_REACTION_ADD / MESSAGE_REACTION_REMOVE to the webhook, so INTERACTION_CREATE never arrives. Making them slash commands would require an Interactions Endpoint URL (with Ed25519 signature verification), so this version uses text commands. No command registration to the app (`POST /applications/{id}/commands`) is needed either.

| Command | Behavior |
| --- | --- |
| `!memory show` | Lists your memories with their ids. Sent as a DM, not to the channel |
| `!memory forget <id>` | Deletes the memory with that id (only your own) |
| `!memory forget all` | Deletes all of your memories |
| `!memory` | Replies with usage |

Mentioning the bot with `memory show` / `memory forget <id>` works the same way. Deletions are recorded in memory_log with `actor=command`. If `show` cannot open a DM, it replies only that fact to the channel and does not reveal the memories.

## Troubleshooting

- Disconnects right after connecting (log shows `4014`): missing intents. Fix the portal settings and run `/connect` again
- Does not react to mentions: check that `DISCORD_APPLICATION_ID` matches the APPLICATION ID and that `/status` is `connected`
- No reply: look for `reply failed` in `npx wrangler tail` (often a wrong AI Gateway key or a wrong model ID in `src/models.ts`)
