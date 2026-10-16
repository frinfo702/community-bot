import { stripBotMentions } from "./discord/mention";
import type { ChoiceQuestion, JevClient } from "./jev";
import type { ChannelContext } from "./prompt";

export type ReplyForm = "stamp" | "text" | "image" | "task";

export interface ReplyFormDecision {
  form: ReplyForm;
  /** true のときは Jev に聞けず既定（text）に倒れた */
  fallback: boolean;
  confidence?: number;
  probabilities?: Partial<Record<ReplyForm, number>>;
}

// Jev の判断に渡す会話の行数
const DECISION_MESSAGES = 10;

const FORM_QUESTION: ChoiceQuestion<ReplyForm> = {
  instructions:
    "How should the bot respond to the latest message in this Discord conversation? Choose the response form.",
  criteria: {
    stamp:
      "A single emoji reaction is enough: agreement, laughter, a light acknowledgment. No text needed.",
    text: "The bot should join the conversation with a written reply.",
    image:
      "The situation calls for an image (for example the user asks to draw something).",
    task: "Something needs multi-step work: research, fixing code, summarizing a document.",
  },
};

/** 直近の会話を Jev に渡す state にする（ログ全体は長いので絞る） */
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

/** 応答形式を Jev に聞く。聞けなければ今までどおり text に倒れる。 */
export async function decideReplyForm(
  jev: JevClient,
  context: ChannelContext,
  botId: string,
): Promise<ReplyFormDecision> {
  const result = await jev.choice(decisionState(context, botId), FORM_QUESTION);
  if (!result.ok) {
    return { form: "text", fallback: true };
  }
  return {
    form: result.value.choice,
    fallback: false,
    confidence: result.value.confidence,
    probabilities: result.value.probabilities,
  };
}
