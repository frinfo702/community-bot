import type { BooleanQuestion, JevClient } from "./jev";
import { conversationLines, type ChannelContext } from "./prompt";

// Number of conversation lines passed to the Jev decision
const DECISION_MESSAGES = 10;

/** Turn the recent conversation into the state passed to Jev (the full log is long, so trim it) */
export function decisionState(context: ChannelContext, botId: string): string {
  return conversationLines(context.messages, botId, DECISION_MESSAGES).join("\n");
}

/** Jev yes-threshold for "an emoji alone is enough". When unsure, continue to the written reply. */
export const EMOJI_ONLY_THRESHOLD = 0.5;

const EMOJI_ONLY_QUESTION: BooleanQuestion = {
  instructions:
    "Should the bot answer the latest message in this Discord conversation with a single emoji reaction alone?",
  criteria: {
    true: "A single emoji reaction is enough: agreement, laughter, or a quick acknowledgment. The conversation does not expect words.",
    false:
      "The message invites a written reply (a question, a greeting, an invitation to talk), or the bot should do something beyond reacting.",
  },
};

export interface EmojiOnlyDecision {
  /** True when a single emoji reaction is enough, so no written reply follows */
  enough: boolean;
  /** True when Jev could not be asked and the decision fell back to the written reply */
  fallback: boolean;
  probability?: number;
}

/** Ask Jev whether an emoji reaction alone is enough. If it cannot be asked, it continues to the written reply. */
export async function decideEmojiOnly(
  jev: JevClient,
  context: ChannelContext,
  botId: string,
): Promise<EmojiOnlyDecision> {
  const result = await jev.boolean(
    decisionState(context, botId),
    EMOJI_ONLY_QUESTION,
  );
  if (!result.ok) return { enough: false, fallback: true };
  return {
    enough: result.value.probability >= EMOJI_ONLY_THRESHOLD,
    fallback: false,
    probability: result.value.probability,
  };
}

/**
 * Jev yes-threshold for replying without a mention. Higher than the mention
 * decisions: an unsolicited reply should be clearly called for, not merely possible.
 */
export const SHOULD_REPLY_THRESHOLD = 0.7;

export interface ShouldReplyDecision {
  reply: boolean;
  /** True when Jev could not be asked and the bot stayed out of the conversation */
  fallback: boolean;
  probability?: number;
}

/**
 * Ask Jev whether a message that did not mention the bot still calls for a reply.
 * The rules come from reply-rules.md so the policy can change without touching this question.
 */
export async function decideShouldReply(
  jev: JevClient,
  context: ChannelContext,
  botId: string,
  rules: string,
): Promise<ShouldReplyDecision> {
  const result = await jev.boolean(decisionState(context, botId), {
    instructions: [
      "Should the bot reply to the latest message in this Discord conversation even though it was not mentioned?",
      "Follow the reply rules. When they do not clearly call for a reply, stay out.",
      "",
      "Reply rules:",
      rules.trim(),
    ].join("\n"),
    criteria: {
      true: "The reply rules call for the bot to join, or the message clearly expects the bot to answer.",
      false:
        "The reply rules say to stay out, or the message is between other members and does not expect the bot.",
    },
  });
  if (!result.ok) return { reply: false, fallback: true };
  return {
    reply: result.value.probability >= SHOULD_REPLY_THRESHOLD,
    fallback: false,
    probability: result.value.probability,
  };
}

/** Jev yes-threshold for "a complex task". When unsure, answer with a normal written reply. */
export const COMPLEX_TASK_THRESHOLD = 0.5;

const COMPLEX_TASK_QUESTION: BooleanQuestion = {
  instructions:
    "Should the reply to the latest message in this Discord conversation be performed as a complex task instead of a normal chat reply?",
  criteria: {
    true: "The message needs multi-step work outside the chat: reading or summarizing a linked page, research, or similar.",
    false: "A normal written reply is enough.",
  },
};

export interface ComplexTaskDecision {
  task: boolean;
  /** True when Jev could not be asked and the decision fell back to the written reply */
  fallback: boolean;
  probability?: number;
}

/** Ask Jev whether the reply is a complex task. If it cannot be asked, it falls back to the written reply. */
export async function decideComplexTask(
  jev: JevClient,
  context: ChannelContext,
  botId: string,
): Promise<ComplexTaskDecision> {
  const result = await jev.boolean(
    decisionState(context, botId),
    COMPLEX_TASK_QUESTION,
  );
  if (!result.ok) return { task: false, fallback: true };
  return {
    task: result.value.probability >= COMPLEX_TASK_THRESHOLD,
    fallback: false,
    probability: result.value.probability,
  };
}

/** Jev yes-threshold for "quote the message this reply answers". */
export const QUOTE_REPLY_THRESHOLD = 0.5;

const QUOTE_REPLY_QUESTION: BooleanQuestion = {
  instructions:
    "The bot is about to answer the latest message in this Discord conversation. Should the answer quote that message? Quoting is for the case where messages to the bot piled up unanswered, so the quote shows which message is being answered.",
  criteria: {
    true: "Two or more messages that expect the bot's answer are waiting since the bot last answered, so which one is answered is not obvious.",
    false:
      "Only one message is waiting, or the exchange is a normal back-and-forth whose target is obvious. Answer plainly and keep the channel readable.",
  },
};

export interface QuoteReplyDecision {
  /** True when the answer quotes the message it replies to */
  quote: boolean;
  /** True when Jev could not be asked and the answer stayed plain */
  fallback: boolean;
  probability?: number;
}

/**
 * Ask Jev whether the answer should quote the message it replies to. Quoting is
 * the exception: it only helps when a pile of unanswered messages makes the
 * target unclear. If Jev cannot be asked, the answer stays plain, the same
 * conservative side as every other failed decision.
 */
export async function decideQuoteReply(
  jev: JevClient,
  context: ChannelContext,
  botId: string,
): Promise<QuoteReplyDecision> {
  const result = await jev.boolean(
    decisionState(context, botId),
    QUOTE_REPLY_QUESTION,
  );
  if (!result.ok) return { quote: false, fallback: true };
  return {
    quote: result.value.probability >= QUOTE_REPLY_THRESHOLD,
    fallback: false,
    probability: result.value.probability,
  };
}
