import type { BooleanQuestion, JevClient } from "./jev";

/** Only the fields of GATEWAY_MESSAGE_REACTION_ADD's data that we use. */
export interface ReactionEvent {
  user_id?: string;
  message_id?: string;
  channel_id?: string;
  emoji?: { id?: string | null; name?: string };
}

export interface ReactionTarget {
  messageId: string;
  userId: string;
  /** The emoji name is enough, even for custom emoji */
  emoji: string;
}

/** Pull out only the reactions that have every field needed for recording. */
export function reactionTarget(event: unknown): ReactionTarget | null {
  if (typeof event !== "object" || event === null) return null;
  const { message_id, user_id, emoji } = event as ReactionEvent;
  if (!message_id || !user_id || !emoji?.name) return null;
  return { messageId: message_id, userId: user_id, emoji: emoji.name };
}

/** Jev yes-threshold for counting a reply as a correction. When unsure, do not count it. */
export const CORRECTION_THRESHOLD = 0.5;

export const CORRECTION_QUESTION: BooleanQuestion = {
  instructions:
    "Is the user's latest message correcting the bot's previous message? A correction points out that the bot was factually wrong or made a wrong assumption, or supplies the right information to fix it.",
  criteria: {
    true: "The user says the bot was wrong or inaccurate, or provides the corrected information for the bot's claim.",
    false: "The user is asking something, adding new information, joking, or continuing the conversation for another reason; not a correction.",
  },
};

export interface CorrectionDecision {
  correction: boolean;
  /** True when Jev could not be asked and it fell back to "no correction" */
  fallback: boolean;
  probability?: number;
}

/** Ask Jev whether a reply to the bot's message is a correction. Falls back to "no" on failure. */
export async function decideCorrection(
  jev: JevClient,
  botMessage: string,
  reply: string,
): Promise<CorrectionDecision> {
  const result = await jev.boolean(
    { bot_message: botMessage, reply },
    CORRECTION_QUESTION,
  );
  if (!result.ok) return { correction: false, fallback: true };
  return {
    correction: result.value.probability >= CORRECTION_THRESHOLD,
    fallback: false,
    probability: result.value.probability,
  };
}
