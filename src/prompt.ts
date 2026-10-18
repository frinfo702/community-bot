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
  /** The message this one quotes, as a "name: body" line (src/discord/mention.ts) */
  quoted?: string;
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

/** Japan has no DST, so a fixed offset matches nightly.ts. */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const pad2 = (value: number) => String(value).padStart(2, "0");

/** JST calendar day number. It increments at JST midnight. */
function jstDay(ms: number): number {
  return Math.floor((ms + JST_OFFSET_MS) / DAY_MS);
}

/**
 * "[今日 13:33] " / "[昨日 23:41] " / "[一昨日 12:15] " for the last three JST
 * calendar days, "[10/15 12:15] " after that (with the year when it differs from
 * now), and "" when createdAt has no clock (0), which probes and fixtures use.
 *
 * Prompt lines only: the Jev state and memory extraction keep the bare form, so a
 * relative day never ends up in a lasting memory note.
 */
export function timePrefix(createdAt: number, now: number): string {
  if (createdAt <= 0) return "";
  const days = jstDay(now) - jstDay(createdAt);
  const date = new Date(createdAt + JST_OFFSET_MS);
  const time = `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}`;
  if (days === 0) return `[今日 ${time}] `;
  if (days === 1) return `[昨日 ${time}] `;
  if (days === 2) return `[一昨日 ${time}] `;

  const nowDate = new Date(now + JST_OFFSET_MS);
  const day =
    date.getUTCFullYear() === nowDate.getUTCFullYear()
      ? `${date.getUTCMonth() + 1}/${date.getUTCDate()}`
      : `${date.getUTCFullYear()}/${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
  return `[${day} ${time}] `;
}

export interface TaskPromptOptions {
  botId: string;
  /** Name of the member who asked, so the agent knows who it is answering */
  authorName: string;
  /** Wall clock at prompt build, used for the relative day labels */
  now: number;
}

/**
 * One line of the log the way the prompts and the Jev state see it: "name: body",
 * plus the quoted message when this one is a reply, so a later "これ" has a referent.
 */
export function logLine(message: LoggedMessage, botId: string): string {
  if (message.isBot) return `bot: ${message.content}`;
  const text = stripBotMentions(message.content, botId) || "(no text)";
  return message.quoted
    ? `${message.authorName}: ${text} (replying to ${message.quoted})`
    : `${message.authorName}: ${text}`;
}

/**
 * The tail of the conversation as text lines ("name: body" / "bot: body"), oldest
 * first. Shared by the Jev state and memory extraction, which read a bare log.
 */
export function conversationLines(
  messages: LoggedMessage[],
  botId: string,
  limit: number,
): string[] {
  return messages.slice(-limit).map((message) => logLine(message, botId));
}

/** One conversation line the way the reply and task prompts present it: day label + body. */
function promptLine(message: LoggedMessage, botId: string, now: number): string {
  return timePrefix(message.createdAt, now) + logLine(message, botId);
}

/** The single user message the task agent receives: recent conversation + the request. */
export function buildTaskPrompt(
  context: ChannelContext,
  options: TaskPromptOptions,
): string {
  const lines = context.messages
    .slice(-TASK_CONTEXT_MESSAGES)
    .map((message) => promptLine(message, options.botId, options.now));
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
  /** Extra system instructions injected just before the persona */
  instructions?: string;
  /** Wall clock at prompt build, used for the relative day labels */
  now: number;
  /** The speaker's profile (memories). Injected with a cap on every reply */
  profile?: SpeakerProfile;
  /** What the bot knows about itself (the botch-doc skill body). Injected before the persona */
  self?: string;
  /** Images of the request message, attached to that message's line */
  images?: { messageId: string; urls: string[] };
}

/**
 * Convert the log into the message list passed to the model. It orders summary → speaker profile →
 * conversation flow → botch-doc → instructions → persona, and re-injects the persona at the end of
 * every turn. Speaker names are kept so it is clear who said what.
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
      // No day label: the model would start writing one in its own replies.
      // The user lines around it carry the time.
      messages.push({ role: "assistant", content: message.content });
    } else {
      const line = promptLine(message, options.botId, options.now);
      // Images ride with the message that asked for the reply. The rest stay text-only:
      // a Discord URL expires, and an old image would be paid for on every turn.
      const images =
        message.id === options.images?.messageId ? options.images.urls : [];
      messages.push({
        role: "user",
        content: userContent(line, images),
      });
    }
  }
  if (options.self) {
    messages.push({ role: "system", content: options.self });
  }
  if (options.instructions) {
    messages.push({ role: "system", content: options.instructions });
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
