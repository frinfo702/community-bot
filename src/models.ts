// 役割ごとのモデルID。Vercel AI Gateway は "provider/model" 形式で書く。
// 用途が増えたらキーを足す（例: utility … 記憶整理などの裏方、image … 画像生成）。
export const models = {
  /** 会話の返信 */
  chat: "anthropic/claude-haiku-5.5",
  /** 画像生成（image 判定のとき）。ID は AI Gateway のカタログに合わせて差し替える */
  image: "openai/gpt-image-1",
  /** 判断（Jev）。TypeSafe API のモデル名はプロバイダ修飾なし */
  decide: "jev-latest",
};
