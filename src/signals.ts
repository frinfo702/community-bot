import type { BooleanQuestion, JevClient } from "./jev";

/** GATEWAY_MESSAGE_REACTION_ADD の data のうち使う分だけ。 */
export interface ReactionEvent {
  user_id?: string;
  message_id?: string;
  channel_id?: string;
  emoji?: { id?: string | null; name?: string };
}

export interface ReactionTarget {
  messageId: string;
  userId: string;
  /** カスタム絵文字も名前で足りる */
  emoji: string;
}

/** 記録に必要な項目がそろったリアクションだけを取り出す。 */
export function reactionTarget(event: unknown): ReactionTarget | null {
  if (typeof event !== "object" || event === null) return null;
  const { message_id, user_id, emoji } = event as ReactionEvent;
  if (!message_id || !user_id || !emoji?.name) return null;
  return { messageId: message_id, userId: user_id, emoji: emoji.name };
}

/** 訂正とみなす Jev の yes 確率の閾値。迷ったら数えない。 */
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
  /** true のときは Jev に聞けず訂正なしに倒れた */
  fallback: boolean;
  probability?: number;
}

/** bot の発言への返信が訂正かどうかを Jev に聞く。聞けなければ訂正なしに倒れる。 */
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
