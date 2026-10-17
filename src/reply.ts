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

/** The message that asked for the reply. */
export interface ReplyRequest {
  channelId: string;
  messageId: string;
  authorId: string;
  authorName: string;
}

export interface TextReply {
  text: string;
  /** The reply as it was logged, so the caller can reuse it (memory extraction) */
  logged: LoggedMessage;
}

/**
 * Generate the normal text reply for one message and post it.
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
  const text = await chatFor(env)(
    buildPrompt(context, {
      botId: env.DISCORD_APPLICATION_ID,
      persona: renderPersona(style ?? undefined),
      // The text path has no skill catalog, so the botch-doc body is passed in
      // directly: the bot should know its own features here too, not deny them
      self: botchDocBody,
      profile: {
        name: request.authorName,
        memories: profile.map((memory) => memory.content),
      },
    }),
  );
  await discord.postMessage(request.channelId, text, {
    replyTo: request.messageId,
  });

  // Log the reply too so it becomes context for the next turn. One reply per message, so a synthetic ID is enough.
  const logged: LoggedMessage = {
    id: `${request.messageId}:reply`,
    channelId: request.channelId,
    authorId: env.DISCORD_APPLICATION_ID,
    authorName: "bot",
    isBot: true,
    content: text,
    createdAt: Date.now(),
  };
  await conversation.append(logged);

  return { text, logged };
}
