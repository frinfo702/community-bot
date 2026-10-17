import { stripBotMentions } from "./discord/mention";
import type { BooleanQuestion, ChoiceQuestion, JevClient } from "./jev";
import type { ChannelContext } from "./prompt";

export type StampEmoji = "👍" | "😂" | "🤔" | "👀";

const DEFAULT_STAMP: StampEmoji = "👍";

// Number of conversation lines passed to the Jev decision
const DECISION_MESSAGES = 10;

/** Turn the recent conversation into the state passed to Jev (the full log is long, so trim it) */
function decisionState(context: ChannelContext, botId: string): string {
  return context.messages
    .slice(-DECISION_MESSAGES)
    .map((message) =>
      message.isBot
        ? `bot: ${message.content}`
        : `${message.authorName}: ${stripBotMentions(message.content, botId) || "(本文なし)"}`,
    )
    .join("\n");
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

export interface StampDecision {
  emoji: StampEmoji;
  /** True when Jev could not be asked and the decision fell back to the default emoji */
  fallback: boolean;
}

const STAMP_QUESTION: ChoiceQuestion<StampEmoji> = {
  instructions: "Which emoji reaction fits the latest message best?",
  criteria: {
    "👍": "Agreement, approval, or a simple acknowledgment.",
    "😂": "Funny; a joke or playful teasing.",
    "🤔": "Skeptical, doubtful, or thinking it over.",
    "👀": "Interested, paying attention, wanting to see more.",
  },
};

/** Ask Jev for the stamp emoji. If it cannot be asked, it falls back to the default (👍). */
export async function decideStampEmoji(
  jev: JevClient,
  context: ChannelContext,
  botId: string,
): Promise<StampDecision> {
  const result = await jev.choice(
    decisionState(context, botId),
    STAMP_QUESTION,
  );
  if (!result.ok) {
    return { emoji: DEFAULT_STAMP, fallback: true };
  }
  return { emoji: result.value.choice, fallback: false };
}
