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

export interface SpeakerProfile {
  name: string;
  /** 上限つきで渡される記憶（呼び出し側で絞る） */
  memories: string[];
}

export interface PromptOptions {
  botId: string;
  /** 末尾に再注入する人格ブロック（renderPersona() の結果） */
  persona: string;
  /** 発言者のプロフィール（記憶）。返信のたびに上限つきで注入する */
  profile?: SpeakerProfile;
}

/**
 * ログをモデルに渡すメッセージ列に変換する。要約 → 発言者のプロフィール → 会話の流れ → 人格の
 * 順に並べ、人格は毎ターン末尾に再注入する。発言者の名前を残して誰の発言か分かるようにする。
 */
export function buildPrompt(
  context: ChannelContext,
  options: PromptOptions,
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  if (context.summary) {
    messages.push({
      role: "system",
      content: `これまでの流れの要約:\n${context.summary}`,
    });
  }
  if (options.profile && options.profile.memories.length > 0) {
    messages.push({
      role: "system",
      content:
        `発言者（${options.profile.name}）について分かっていること:\n` +
        options.profile.memories.map((memory) => `- ${memory}`).join("\n"),
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
  messages.push({ role: "system", content: options.persona });
  return messages;
}
