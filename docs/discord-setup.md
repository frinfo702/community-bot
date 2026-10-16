# Discord アプリのセットアップ

## 1. アプリを作成する

1. https://discord.com/developers/applications を開き、New Application から `community-bot` を作成する
2. General Information の `APPLICATION ID` を控える（= `DISCORD_APPLICATION_ID`）

## 2. Bot を有効にして intents を設定する

1. 左メニューの Bot を開く
2. `MESSAGE CONTENT INTENT` を ON にする（これが無いとメッセージ本文が空で届く）
3. Token を Reset して `DISCORD_BOT_TOKEN` として控える

必要な intents は GUILDS / GUILD_MESSAGES / MESSAGE_CONTENT / GUILD_MESSAGE_REACTIONS。通常のものは既定で有効なので、ポータルで ON にするのは MESSAGE CONTENT だけでよい。4人のサーバーなので特権 intent の審査は不要。

## 3. サーバーに招待する

以下の URL の `<APP_ID>` を APPLICATION ID に置き換えて開く。

```text
https://discord.com/api/oauth2/authorize?client_id=<APP_ID>&scope=bot%20applications.commands&permissions=117824
```

`permissions=117824` は View Channel / Send Messages / Embed Links / Attach Files / Read Message History / Add Reactions の和。足りない権限があれば Discord の権限計算で増やす。

導入先は4人のサーバーを選ぶ。

## 4. Cloudflare に secrets を登録する

```bash
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put DISCORD_APPLICATION_ID
npx wrangler secret put DISCORD_GATEWAY_SECRET
npx wrangler secret put ADMIN_SECRET
```

`DISCORD_GATEWAY_SECRET` と `ADMIN_SECRET` は `openssl rand -hex 32` などで生成した任意の文字列でよい。

## 5. 接続する

```bash
curl -X POST https://community-bot.<subdomain>.workers.dev/connect \
  -H "x-admin-secret: $ADMIN_SECRET"
```

## トラブルシューティング

- 接続直後に切れる（ログに `4014`）: intents の設定漏れ。ポータルの設定を直してから `/connect` を実行し直す
- メンションに反応しない: `DISCORD_APPLICATION_ID` が APPLICATION ID と一致しているか、`/status` が `connected` かを確認する
- 返信が来ない: `npx wrangler tail` で `reply failed` のログを見る（AI Gateway のキーや `src/models.ts` のモデルIDの誤りが多い）
