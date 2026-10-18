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
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_GATEWAY_SECRET
npx wrangler secret put ADMIN_SECRET
```

`DISCORD_PUBLIC_KEY` is the `PUBLIC KEY` on the General Information page. The Worker uses it to verify the Ed25519 signature Discord puts on every interaction. `DISCORD_GATEWAY_SECRET` and `ADMIN_SECRET` can be any strings, for example from `openssl rand -hex 32`.

## 5. Connect

```bash
curl -X POST https://community-bot.<subdomain>.workers.dev/connect \
  -H "x-admin-secret: $ADMIN_SECRET"
```

## 6. Register the slash commands

The definitions live in `src/commands.ts` and are sent to Discord from the Worker, so there is no second copy of them.

```bash
curl -X POST https://community-bot.<subdomain>.workers.dev/commands/register \
  -H "x-admin-secret: $ADMIN_SECRET"
```

`PUT /applications/{id}/commands` replaces the whole global list, so this is safe to run again after a deploy. Global commands can take up to an hour to appear; re-opening Discord usually shows them sooner.

Then set the Interactions Endpoint URL on the General Information page to the same origin plus `/interactions`:

```text
https://community-bot.<subdomain>.workers.dev/interactions
```

The portal sends a PING when you save, and it only accepts the URL when the Worker answers it. Deploy with `DISCORD_PUBLIC_KEY` set before this step. Discord then sends interactions to that URL instead of the Gateway, so the Gateway library never sees `INTERACTION_CREATE` and no webhook changes are needed.

## Memory commands

Members manage their own per-user memories (ISSUE-1879). These are Discord slash commands, so every reply is ephemeral: only the member who ran the command sees it, and nothing appears in the channel.

| Command | Behavior |
| --- | --- |
| `/memory show` | Lists your memories with their ids |
| `/memory forget id:<id>` | Deletes the memory with that id (only your own) |
| `/memory forget id:all` | Deletes all of your memories |
| `/memory` | Replies with usage |

The text commands still work:

| Command | Behavior |
| --- | --- |
| `!memory show` | Lists your memories, sent as a DM |
| `!memory forget <id>` | Deletes the memory with that id |
| `!memory forget all` | Deletes all of your memories |
| `!memory` | Replies with usage |

Mentioning the bot with `memory show` / `memory forget <id>` works the same way. A text command is visible to the channel, so `show` goes to a DM and the channel only gets a short confirmation; if the DM cannot be opened, the bot says so without revealing the memories. Deletions are recorded in memory_log with `actor=command`.

## Cafe Activity

`/cafe` opens the pixel-art tearoom as a Discord Activity. The bot only answers the command with `LAUNCH_ACTIVITY`; the scene itself is a static web app in `cafe/`, deployed as a separate Worker named `yachiyo-cafe`.

1. Build and deploy the Activity:

   ```bash
   cd cafe
   npm install
   npm run build
   npx wrangler deploy
   ```

2. In the developer portal, open Activities:
   - Turn on `Enable Activities`
   - Add a URL mapping `/` → `yachiyo-cafe.<subdomain>.workers.dev`
   - Add an OAuth2 redirect URI such as `https://127.0.0.1` (a placeholder; the scene does not request scopes)

3. Deploy the bot and run `POST /commands/register` again so Discord learns about `/cafe`.

The scene is a palette-quantised 640×360 illustration animated with lamp flicker, petals, steam, dust, a blink, and a wind that swings the wind chime tag, the noren, and the cherry tree outside. It uses a fixed camera, so everyone sees the same room; there is no shared state yet, and no OAuth or user data is read. `?scene=3d` opens the earlier three.js room. The BGM is an AAC file served by the same Worker (`cafe/public/music/`), with the track title and prev / play / next buttons at the bottom left. Audio starts on the first click because browsers block autoplay.

Preview locally with `cd cafe && npm run dev`. The dev server is a plain web page; Discord is only needed to check the iframe and the launch flow.

## Troubleshooting

- Disconnects right after connecting (log shows `4014`): missing intents. Fix the portal settings and run `/connect` again
- Does not react to mentions: check that `DISCORD_APPLICATION_ID` matches the APPLICATION ID and that `/status` is `connected`
- No reply: look for `reply failed` in `npx wrangler tail` (often a wrong AI Gateway key or a wrong model ID in `src/models.ts`)
- The portal refuses the Interactions Endpoint URL: the Worker answered something other than the PING — check that `DISCORD_PUBLIC_KEY` is the app's key and that `/interactions` is deployed
- `/memory` does not show up: run `/commands/register`, then re-open Discord (global commands can take up to an hour)
