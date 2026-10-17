import { stripBotMentions } from "./discord/mention";
import type { ChatMessage } from "./llm";

/** One entry kept in the log. The body is stored raw, unprocessed. */
export interface LoggedMessage {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string;
  isBot: boolean;
  content: string;
  createdAt: number;
}

/** The channel context used for replies. messages are ordered oldest to newest. */
export interface ChannelContext {
  summary: string | null;
  messages: LoggedMessage[];
}

export interface SpeakerProfile {
  name: string;
  /** Memories passed in with a cap (trimmed by the caller) */
  memories: string[];
}

/** Lines of conversation handed to the task agent so it can resolve references like "これ" */
const TASK_CONTEXT_MESSAGES = 10;

export interface TaskPromptOptions {
  botId: string;
  /** Name of the member who asked, so the agent knows who it is answering */
  authorName: string;
}

/**
 * The tail of the conversation as text lines ("name: body" / "bot: body"), oldest
 * first. Shared by the prompts and the Jev state, which all see a trimmed log.
 */
export function conversationLines(
  messages: LoggedMessage[],
  botId: string,
  limit: number,
): string[] {
  return messages.slice(-limit).map((message) =>
    message.isBot
      ? `bot: ${message.content}`
      : `${message.authorName}: ${stripBotMentions(message.content, botId) || "(本文なし)"}`,
  );
}

/** The single user message the task agent receives: recent conversation + the request. */
export function buildTaskPrompt(
  context: ChannelContext,
  options: TaskPromptOptions,
): string {
  const lines = conversationLines(
    context.messages,
    options.botId,
    TASK_CONTEXT_MESSAGES,
  );
  return [
    "Discord のチャンネルでの直近の会話:",
    ...lines,
    "",
    `最後のメッセージ（${options.authorName}）が依頼です。`,
  ].join("\n");
}

export interface PromptOptions {
  botId: string;
  /** The persona block re-injected at the end (the result of renderPersona()) */
  persona: string;
  /** The speaker's profile (memories). Injected with a cap on every reply */
  profile?: SpeakerProfile;
}

/**
 * Convert the log into the message list passed to the model. It orders summary → speaker profile →
 * conversation flow → persona, and re-injects the persona at the end of every turn. Speaker names
 * are kept so it is clear who said what.
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
