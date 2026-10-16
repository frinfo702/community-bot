# community-bot

4人のDiscordサーバーに住むAI bot。インフラは全てCloudflareで完結し、常時起動のマシンを持たない。

- Gateway 接続は [discord-gateway-cloudflare-do](https://github.com/dcartertwo/discord-gateway-cloudflare-do)（Durable Object が Discord Gateway の WebSocket を保持し、イベントを Worker に転送する）
- モデルは Vercel AI Gateway（OpenAI 互換）
- 処理の流れ:
  Discord → Gateway DO → `POST /webhook` → 会話ログを DO SQLite に保存 → メンション検知 → AI Gateway で生成（直近の文脈つき）→ Discord REST で投稿

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
npx wrangler secret put JEV_API_KEY

npm run deploy
```

初回はこのまま手元からデプロイします。2回目以降は main への push で GitHub Actions がデプロイします（下の CI/CD を参照）。

デプロイ後の確認と Gateway 接続:

```bash
curl -X POST https://community-bot.<subdomain>.workers.dev/connect \
  -H "x-admin-secret: $ADMIN_SECRET"

curl -H "x-admin-secret: $ADMIN_SECRET" \
  https://community-bot.<subdomain>.workers.dev/status
```

`/status` が `{"status":"connected", ...}` になれば完了。サーバーで bot にメンションすると返信する。

人格が保たれているかは人格プローブで計測できます（冗談・本物 distress・キャラ破壊要求の20問を投げ、Jev 審判が説教・遷移を判定して逸脱率を返します）。

```bash
curl -X POST https://community-bot.<subdomain>.workers.dev/probe \
  -H "x-admin-secret: $ADMIN_SECRET"
```

## 環境変数

| 名前 | 用途 |
| --- | --- |
| `DISCORD_BOT_TOKEN` | Discord bot トークン |
| `DISCORD_APPLICATION_ID` | アプリID（bot ユーザーIDと同じ）。メンション判定に使う |
| `DISCORD_GATEWAY_SECRET` | Gateway DO → Worker の webhook 認証 |
| `ADMIN_SECRET` | `/connect` `/disconnect` `/status` の保護 |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway のキー |
| `AI_GATEWAY_BASE_URL` | 省略時 `https://ai-gateway.vercel.sh/v1` |
| `JEV_API_KEY` | TypeSafe（Jev）の API キー |
| `JEV_BASE_URL` | 省略時 `https://api.typesafe.ai/v1` |

使うモデルIDは secrets ではなくコード内の `src/models.ts` で管理する（役割ごとにキーを足す）。

## CI/CD

- PR と main への push で型検査とテストが走ります（`.github/workflows/ci.yml`）
- main への push では、テストが通ったあとに `npm run deploy` が実行され、Cloudflare へ自動でデプロイされます
- 手動で再デプロイしたい場合は Actions の `CI/CD` ワークフローを `workflow_dispatch` で実行してください

リポジトリの secrets（Settings → Secrets and variables → Actions）に次の2つを登録してください。

| 名前 | 内容 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Workers を編集できる API トークン。ダッシュボードの「Edit Cloudflare Workers」テンプレートで作成できます |
| `CLOUDFLARE_ACCOUNT_ID` | `npx wrangler whoami` で確認できます |

実行時の secrets（`DISCORD_BOT_TOKEN` など）は Cloudflare 側に保存されており、Actions からのデプロイでは変更されません。

## 開発

```bash
npm run dev        # wrangler dev
npm test           # vitest
npm run typecheck  # tsc --noEmit
npm run deploy     # wrangler deploy
```

人格の定義は `persona.md`。`core` は人が管理し、`style` だけが自己改善（ISSUE-1867）の対象です。

## いまできること

- メンションへの返信（typing 表示つき、元メッセージへのリプライ）
- 会話ログの DO SQLite 保存（チャンネル単位）と、直近20件+要約を使った文脈つき返信（ISSUE-1877）
- Jev クライアント（choice / boolean / score の型付き判断、ISSUE-1878）
- Jev による応答形式の判定（stamp / text / image / task。image・task はテキストへフォールバック、ISSUE-1876）
- 絵文字リアクション（スタンプ）での応答（ISSUE-1875）
- ユーザーごとの記憶（memories / episodes / memory_log）と発言者のプロフィール注入（ISSUE-1872）
- 人格プローブ（20問）と逸脱率の計測（POST /probe、ISSUE-1880）
- persona.md（固定コア+スタイル層）の毎ターン末尾への再注入（ISSUE-1865）
- メッセージIDによる重複排除
- Gateway の接続・切断・状態確認

いまできないこと（issue 管理は Linear の community-bot プロジェクト）:

- 記憶の自動更新と夜間整理（ISSUE-1869 / 1874）
