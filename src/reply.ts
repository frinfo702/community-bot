import { DiscordClient } from "./discord/client";
import type { Env } from "./env";
import { chatFor } from "./llm";
import { renderPersona } from "./persona";
import {
  buildPrompt,
  PROFILE_MEMORIES,
  RECENT_MESSAGES,
  type LoggedMessage,
} from "./prompt";
import { botchDocBody } from "./skill-files";
import { SPLIT_MARKER, splitReply } from "./split";

/** The message that asked for the reply. */
export interface ReplyRequest {
  channelId: string;
  messageId: string;
  authorId: string;
  authorName: string;
  /** Images on that message, passed to the model as content parts */
  images?: string[];
  /** Quote the asking message. The exception: decideQuoteReply says when it helps. */
  quote: boolean;
  /**
   * An acknowledgment the bot already posted (the task path). When present the
   * first part edits it in place instead of posting a new message.
   */
  placeholder?: Placeholder;
}

/** One posted message the bot may edit later, once an answer is ready. */
export interface Placeholder {
  channelId: string;
  messageId: string;
}

export interface TextReply {
  text: string;
  /** The reply as it was logged, so the caller can reuse it (memory extraction) */
  logged: LoggedMessage;
}

/**
 * How a reply may become two messages. Appended as a system block by the text
 * reply path only: the task path deliberately answers in one message.
 */
const SPLIT_INSTRUCTION = [
  "You may send a short second message before the answer when the answer is long.",
  `Separate the messages with a line that contains only ${SPLIT_MARKER}, at most once.`,
  "Use it only when the request invites a long answer (research, a comparison, a walkthrough).",
  "The first message is a short lead-in in your own voice; the second carries the answer.",
  "Never split greetings, quick answers, or ordinary back-and-forth; when in doubt, do not split.",
  `The marker appears only between the messages. Never write it at the start, at the end, or anywhere else.`,
].join("\n");

/**
 * Put the text where the acknowledgment sits: edit it in place, or post a new
 * message when the edit fails (the acknowledgment was deleted, most likely).
 * Shared by the text reply and the task agent so both handle that the same way.
 */
export async function deliverReply(
  discord: DiscordClient,
  request: ReplyRequest,
  text: string,
): Promise<void> {
  if (request.placeholder) {
    try {
      await discord.editMessage(
        request.placeholder.channelId,
        request.placeholder.messageId,
        text,
      );
      return;
    } catch (err) {
      console.error("edit placeholder failed", request.messageId, err);
    }
  }
  await discord.postMessage(
    request.channelId,
    text,
    request.quote ? { replyTo: request.messageId } : {},
  );
}

/**
 * Generate the normal text reply for one message and post it. The model may
 * split a long answer into two messages; the first part edits the placeholder
 * (the task path's acknowledgment) when one was posted, and the later parts
 * follow in the channel.
 *
 * Used by the mention path and, as the fallback, by the task agent: the task
 * turn runs in a DO that outlives the webhook, so its fallback cannot run there.
 */
export async function replyWithText(
  env: Env,
  request: ReplyRequest,
): Promise<TextReply> {
  const conversation = env.CONVERSATION.get(
    env.CONVERSATION.idFromName("log"),
  );
  const context = await conversation.context(
    request.channelId,
    RECENT_MESSAGES,
  );
  const profile = await conversation.memories(
    request.authorId,
    PROFILE_MEMORIES,
    "reply",
  );
  // Reflect the style override set by the nightly revision (ISSUE-1867). The core stays persona.md
  const style = await conversation.activeStyle();
  const discord = new DiscordClient({ token: env.DISCORD_BOT_TOKEN });
  await discord.triggerTyping(request.channelId);
  const prompt = buildPrompt(context, {
    botId: env.DISCORD_APPLICATION_ID,
    persona: renderPersona(style ?? undefined),
    images: request.images?.length
      ? { messageId: request.messageId, urls: request.images }
      : undefined,
    // The text path has no skill catalog, so the botch-doc body is passed in
    // directly: the bot should know its own features here too, not deny them
    self: botchDocBody,
    profile: {
      name: request.authorName,
      memories: profile.map((memory) => memory.content),
    },
  });
  // The split instruction rides just before the persona, so the persona stays
  // the last thing the model reads (this path has no skill catalog to carry it).
  prompt.splice(prompt.length - 1, 0, {
    role: "system",
    content: SPLIT_INSTRUCTION,
  });
  const parts = splitReply(await chatFor(env)(prompt));
  if (parts.length === 0) throw new Error("chat returned no reply text");

  const [first, ...rest] = parts;
  await deliverReply(discord, request, first);
  for (const part of rest) {
    await discord.postMessage(request.channelId, part);
  }

  // Log every part so the next turn sees the whole reply. The parts share the
  // synthetic id prefix and are numbered in order; createdAt goes up by one so
  // the context query (created_at, id in ascending order) keeps that order even
  // when the parts were posted in the same millisecond.
  const now = Date.now();
  const logged = logReply(env, request, first, 0, now);
  await conversation.append(logged);
  for (const [index, part] of rest.entries()) {
    await conversation.append(logReply(env, request, part, index + 1, now + index + 1));
  }

  return { text: first, logged };
}

/** One posted part as a stored bot message. The id keeps the parts in order. */
function logReply(
  env: Env,
  request: ReplyRequest,
  content: string,
  index: number,
  createdAt: number,
): LoggedMessage {
  return {
    id: `${request.messageId}:reply:${index}`,
    channelId: request.channelId,
    authorId: env.DISCORD_APPLICATION_ID,
    authorName: "bot",
    isBot: true,
    content,
    createdAt,
  };
}
