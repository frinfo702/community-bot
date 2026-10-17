import { stripBotMentions } from "./discord/mention";
import type { ChatMessage, ContentPart } from "./llm";

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

/** Lines of conversation handed to the task agent so it can resolve references like "this one" */
const TASK_CONTEXT_MESSAGES = 10;

/** Number of recent messages included in the reply prompt */
export const RECENT_MESSAGES = 20;

/** Cap on the speaker's memories included in the reply prompt */
export const PROFILE_MEMORIES = 10;

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
      : `${message.authorName}: ${stripBotMentions(message.content, botId) || "(no text)"}`,
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
    "Recent conversation in this Discord channel:",
    ...lines,
    "",
    `The last message (from ${options.authorName}) is the request.`,
  ].join("\n");
}

export interface PromptOptions {
  botId: string;
  /** The persona block re-injected at the end (the result of renderPersona()) */
  persona: string;
  /** The speaker's profile (memories). Injected with a cap on every reply */
  profile?: SpeakerProfile;
  /** What the bot knows about itself (the botch-doc skill body). Injected before the persona */
  self?: string;
  /** Images of the request message, attached to that message's line */
  images?: { messageId: string; urls: string[] };
}

/**
 * Convert the log into the message list passed to the model. It orders summary → speaker profile →
 * conversation flow → botch-doc → persona, and re-injects the persona at the end of every turn.
 * Speaker names are kept so it is clear who said what.
 */
export function buildPrompt(
  context: ChannelContext,
  options: PromptOptions,
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  if (context.summary) {
    messages.push({
      role: "system",
      content: `Summary of the conversation so far:\n${context.summary}`,
    });
  }
  if (options.profile && options.profile.memories.length > 0) {
    messages.push({
      role: "system",
      content:
        `What is known about the speaker (${options.profile.name}):\n` +
        options.profile.memories.map((memory) => `- ${memory}`).join("\n"),
    });
  }
  for (const message of context.messages) {
    if (message.isBot) {
      messages.push({ role: "assistant", content: message.content });
    } else {
      const text =
        stripBotMentions(message.content, options.botId) || "(no text)";
      // Images ride with the message that asked for the reply. The rest stay text-only:
      // a Discord URL expires, and an old image would be paid for on every turn.
      const images =
        message.id === options.images?.messageId ? options.images.urls : [];
      messages.push({
        role: "user",
        content: userContent(`${message.authorName}: ${text}`, images),
      });
    }
  }
  if (options.self) {
    messages.push({ role: "system", content: options.self });
  }
  messages.push({ role: "system", content: options.persona });
  return messages;
}

/** The user content for one line: plain text, or the text with the images attached to it. */
function userContent(line: string, images: string[]): string | ContentPart[] {
  if (images.length === 0) return line;
  return [{ type: "text", text: line }, ...images.map(imagePart)];
}

function imagePart(url: string): ContentPart {
  return { type: "image_url", image_url: { url } };
}
