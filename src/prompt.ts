import { stripBotMentions } from "./discord/mention";
import type { ChatMessage } from "./llm";

/** ログに残す1件。本文は加工せず生のまま持つ。 */
export interface LoggedMessage {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string;
  isBot: boolean;
  content: string;
  createdAt: number;
}

/** 返信に使うチャンネルの文脈。messages は古い→新しい順。 */
export interface ChannelContext {
  summary: string | null;
  messages: LoggedMessage[];
}

export interface PromptOptions {
  botId: string;
  /** 先頭に置く下地の指示（persona.md の導入で置き換える想定） */
  system?: string;
}

/**
 * ログをモデルに渡すメッセージ列に変換する。要約 → 会話の流れの順に並べ、
 * 発言者の名前を残して誰の発言か分かるようにする。
 */
export function buildPrompt(
  context: ChannelContext,
  options: PromptOptions,
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  if (options.system) {
    messages.push({ role: "system", content: options.system });
  }
  if (context.summary) {
    messages.push({
      role: "system",
      content: `これまでの流れの要約:\n${context.summary}`,
    });
  }
  for (const message of context.messages) {
    if (message.isBot) {
      messages.push({ role: "assistant", content: message.content });
    } else {
      const text =
        stripBotMentions(message.content, options.botId) || "(本文なし)";
      messages.push({ role: "user", content: `${message.authorName}: ${text}` });
    }
  }
  return messages;
}
