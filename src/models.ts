// 役割ごとのモデルID。Vercel AI Gateway の "provider/model" 形式で書く。
// 用途が増えたらキーを足す（例: utility … 記憶整理などの裏方、image … 画像生成）。
export const models = {
  /** 会話の返信 */
  chat: "anthropic/claude-haiku-5.5",
};
