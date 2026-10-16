# community-bot

4人のDiscordサーバーに住むAI bot。インフラは全てCloudflareで完結し、常時起動のマシンを持たない。

- Gateway 接続は [discord-gateway-cloudflare-do](https://github.com/dcartertwo/discord-gateway-cloudflare-do)（Durable Object が Discord Gateway の WebSocket を保持し、イベントを Worker に転送する）
- モデルは Vercel AI Gateway（OpenAI 互換）
- 処理の流れ:
  Discord → Gateway DO → `POST /webhook` → メンション検知 → AI Gateway で生成 → Discord REST で投稿

## 必要なもの

- Node.js 20+
- Cloudflare アカウント（Workers Paid プラン。Durable Objects と常時接続のため）
- Discord アプリ（作成手順は docs/discord-setup.md）
- Vercel AI Gateway の API キーと使うモデルID

## セットアップ

```bash
npm install
cp .dev.vars.example .dev.vars   # ローカル開発用

npx wrangler login
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put DISCORD_APPLICATION_ID
npx wrangler secret put DISCORD_GATEWAY_SECRET   # 任意のランダム文字列
npx wrangler secret put ADMIN_SECRET             # 任意のランダム文字列
npx wrangler secret put AI_GATEWAY_API_KEY
npx wrangler secret put CHAT_MODEL               # 例: provider/model 形式

npm run deploy
```

デプロイ後の確認と Gateway 接続:

```bash
curl -X POST https://community-bot.<subdomain>.workers.dev/connect \
  -H "x-admin-secret: $ADMIN_SECRET"

curl -H "x-admin-secret: $ADMIN_SECRET" \
  https://community-bot.<subdomain>.workers.dev/status
```

`/status` が `{"status":"connected", ...}` になれば完了。サーバーで bot にメンションすると返信する。

## 環境変数

| 名前 | 用途 |
| --- | --- |
| `DISCORD_BOT_TOKEN` | Discord bot トークン |
| `DISCORD_APPLICATION_ID` | アプリID（bot ユーザーIDと同じ）。メンション判定に使う |
| `DISCORD_GATEWAY_SECRET` | Gateway DO → Worker の webhook 認証 |
| `ADMIN_SECRET` | `/connect` `/disconnect` `/status` の保護 |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway のキー |
| `CHAT_MODEL` | Gateway 経由のモデルID |
| `AI_GATEWAY_BASE_URL` | 省略時 `https://ai-gateway.vercel.sh/v1` |

## 開発

```bash
npm run dev        # wrangler dev
npm test           # vitest
npm run typecheck  # tsc --noEmit
npm run deploy     # wrangler deploy
```

## いまできること

- メンションへの返信（typing 表示つき、元メッセージへのリプライ）
- メッセージIDによる重複排除
- Gateway の接続・切断・状態確認

いまできないこと（issue 管理は Linear の community-bot プロジェクト）:

- 会話履歴の保存と文脈つき返信（ISSUE-1877）
- Jev によるルーティングと安全レーン分け（ISSUE-1878 / 1876 / 1866）
- persona.md の注入（ISSUE-1865）
- 記憶と夜間整理（ISSUE-1872 / 1869 / 1874）
