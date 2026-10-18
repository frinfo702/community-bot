import { DiscordClient } from "./discord/client";
import type { Env } from "./env";
import { chatFor, type ChatMessage } from "./llm";
import { renderPersona } from "./persona";
import { conversationLines, type ChannelContext } from "./prompt";

/** The line posted when the model cannot write a shorter one. */
export const FALLBACK_ACK = "少し待て、調べてみる";

/** An acknowledgment is one short line; anything longer is not one. */
const ACK_LIMIT = 40;

/** The acknowledgment shares the webhook's 30 seconds with the task dispatch. */
const ACK_TIMEOUT_MS = 10_000;

/** Lines of conversation the acknowledgment reads: enough to catch the topic. */
const ACK_CONTEXT_MESSAGES = 6;

const ACK_INSTRUCTION = [
  "You are about to start a request that takes a while to answer.",
  "Write the one short message you send first: you heard the request and will look into it.",
  "Write in Japanese, in your own voice, as one short line of about 20 characters.",
  "No question, no plan, no result, no preamble. Output only that message.",
].join("\n");

/** What one acknowledgment needs: the conversation so far, and the bot's voice. */
export interface AckInput {
  context: ChannelContext;
  botId: string;
  persona: string;
}

/**
 * The text for one acknowledgment: the model's first line when it is short
 * enough, the fixed fallback line otherwise. Never throws.
 */
export async function ackText(
  generate: (messages: ChatMessage[]) => Promise<string>,
  input: AckInput,
): Promise<string> {
  try {
    const line = (await generate(ackPrompt(input))).split("\n")[0].trim();
    if (line && line.length <= ACK_LIMIT) return line;
  } catch (err) {
    console.error("ack generation failed", err);
  }
  return FALLBACK_ACK;
}

/**
 * Post the short acknowledgment a task starts with, in the bot's own voice
 * (persona + active style): a silent message quoting the request, so the answer
 * that follows is what notifies. A failure costs only the acknowledgment; the
 * task still runs and posts its answer.
 */
export async function acknowledgeTask(
  env: Env,
  request: { channelId: string; messageId: string; context: ChannelContext },
): Promise<void> {
  const conversation = env.CONVERSATION.get(
    env.CONVERSATION.idFromName("log"),
  );
  try {
    const style = await conversation.activeStyle();
    const ack = await ackText(chatFor(env, ACK_TIMEOUT_MS), {
      context: request.context,
      botId: env.DISCORD_APPLICATION_ID,
      persona: renderPersona(style ?? undefined),
    });
    const discord = new DiscordClient({ token: env.DISCORD_BOT_TOKEN });
    await discord.postMessage(request.channelId, ack, {
      replyTo: request.messageId,
      silent: true,
    });
  } catch (err) {
    console.error("ack failed", request.messageId, err);
  }
}

/** What the model reads: the conversation tail, the instruction, then the persona. */
function ackPrompt(input: AckInput): ChatMessage[] {
  return [
    {
      role: "user",
      content: [
        "Recent conversation in this Discord channel:",
        ...conversationLines(
          input.context.messages,
          input.botId,
          ACK_CONTEXT_MESSAGES,
        ),
        "",
        "The last message is the request you are about to start.",
      ].join("\n"),
    },
    { role: "system", content: ACK_INSTRUCTION },
    { role: "system", content: input.persona },
  ];
}
