import { DiscordClient } from "./discord/client";
import type { Env } from "./env";
import { jevFor } from "./jev";
import { chatFor } from "./llm";
import { renderPersona } from "./persona";
import {
  buildPrompt,
  conversationLines,
  PROFILE_MEMORIES,
  RECENT_MESSAGES,
  type LoggedMessage,
  type PromptOptions,
} from "./prompt";
import { botchDocBody } from "./skill-files";
import { SPLIT_MARKER, splitReply } from "./split";
import {
  PRECEDING_LINES,
  repeatGate,
  reviewReply,
  type ReplyGate,
  type RetryInput,
} from "./validation";

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
}

/**
 * How a reply may become two messages. Passed to the prompt by the text reply
 * path only: the task path deliberately answers in one message.
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
 * Generate the normal text reply for one message and post it. The model may
 * split a long answer into two messages; the parts are posted in order.
 *
 * Returns every posted part as it was logged, so the caller can reuse them
 * (memory extraction). Used by the mention path and, as the fallback, by the
 * task agent: the task turn runs in a DO that outlives the webhook, so its
 * fallback cannot run there.
 *
 * Empty when every reply gate withheld the generation and the cut left nothing:
 * the whole reply had already been said, so nothing is posted.
 */
export async function replyWithText(
  env: Env,
  request: ReplyRequest,
): Promise<LoggedMessage[]> {
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
  const options: PromptOptions = {
    botId: env.DISCORD_APPLICATION_ID,
    now: Date.now(),
    persona: renderPersona(style ?? undefined),
    // The split instruction rides just before the persona, so the persona
    // stays the last thing the model reads
    instructions: SPLIT_INSTRUCTION,
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
  };
  const generate = chatFor(env);

  // The chat path is reviewed before anything is posted: a gate can cut the
  // repeated part and ask the model again through the same prompt seam, so the
  // retry keeps the day labels, the split rule and the persona (src/validation.ts).
  // The task agent's answer stays unreviewed.
  const reviewed = await reviewReply(
    {
      gates: replyGates(env),
      retry: (retryInput) =>
        generate(
          buildPrompt(context, {
            ...options,
            instructions: `${SPLIT_INSTRUCTION}\n\n${retryInstruction(retryInput)}`,
          }),
        ),
      // A withheld generation is kept as its own row, so the log shows that a
      // reply was generated and judged inadequate
      onReject: (rejection) =>
        conversation.recordReplyRejection({
          messageId: request.messageId,
          channelId: request.channelId,
          gate: rejection.gate,
          reason: rejection.reason,
          text: rejection.text,
        }),
      log: (message) =>
        console.log("reply review", request.messageId, message),
    },
    {
      text: await generate(buildPrompt(context, options)),
      preceding: conversationLines(
        context.messages,
        env.DISCORD_APPLICATION_ID,
        PRECEDING_LINES,
      ),
    },
  );
  if (!reviewed) {
    console.log("reply review", request.messageId, "nothing new to post");
    return [];
  }
  const parts = splitReply(reviewed);
  if (parts.length === 0) throw new Error("chat returned no reply text");

  // Post and log each part in order. Logging right after the post keeps the
  // stored reply in step with the channel when a later part fails to send.
  const logged: LoggedMessage[] = [];
  for (const [index, part] of parts.entries()) {
    await discord.postMessage(
      request.channelId,
      part,
      index === 0 && request.quote ? { replyTo: request.messageId } : {},
    );
    const entry = logReply(env, request, part, index);
    await conversation.append(entry);
    logged.push(entry);
  }
  return logged;
}

/** The gates every chat reply passes before it is posted. Add new checks here. */
function replyGates(env: Env): ReplyGate[] {
  return [repeatGate(jevFor(env))];
}

/**
 * What the retry turn adds to the instructions block: the reply that was
 * withheld and the lines the gate cut from it.
 */
export function retryInstruction(retry: RetryInput): string {
  return [
    "Your previous reply was not posted: it repeated what the conversation had already said.",
    retry.withheld,
    retry.cut.length > 0
      ? `The repeated lines cut from it: ${retry.cut.join(" ")}`
      : "",
    "Write the reply again. Say only what has not been said yet, and do not repeat a line from the conversation above, your own earlier replies included.",
    retry.text ? `The reply so far, after the cut: ${retry.text}` : "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/**
 * One posted part as a stored bot message. The number in the id orders the
 * parts, which is also how the context query breaks a same-millisecond tie.
 */
function logReply(
  env: Env,
  request: ReplyRequest,
  content: string,
  index: number,
): LoggedMessage {
  return {
    id: `${request.messageId}:reply:${index}`,
    channelId: request.channelId,
    authorId: env.DISCORD_APPLICATION_ID,
    authorName: "bot",
    isBot: true,
    content,
    createdAt: Date.now(),
  };
}
