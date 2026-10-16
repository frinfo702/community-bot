import { ConversationDO } from "./conversation";
import { DedupeDO } from "./dedupe";
import { DiscordClient } from "./discord/client";
import {
  isBotMentioned,
  type DiscordMessage,
} from "./discord/mention";
import type { Env } from "./env";
import { GatewayDO } from "./gateway";
import { chat } from "./llm";
import { models } from "./models";
import { buildPrompt } from "./prompt";

export { GatewayDO, DedupeDO, ConversationDO };

// 暫定のシステムプロンプト。persona.md の導入（ISSUE-1865）で置き換える。
const SYSTEM_PROMPT =
  "あなたは4人の大学院生のDiscordサーバーに住むAIメンバー。親しみやすいタメ口で、長すぎない返事をする。";

// 返信プロンプトに含める直近メッセージ数
const RECENT_MESSAGES = 20;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return new Response("community-bot");
    }

    if (url.pathname === "/connect" && request.method === "POST") {
      if (!isAdmin(request, env)) return unauthorized();
      try {
        return Response.json(
          await gatewayStub(env).start({
            botToken: env.DISCORD_BOT_TOKEN,
            webhookUrl: `${url.origin}/webhook`,
            webhookSecret: env.DISCORD_GATEWAY_SECRET,
          }),
        );
      } catch (err) {
        // DO 側の例外を 1101 の HTML ではなく読める JSON で返す
        console.error("connect failed", err);
        return Response.json({ error: formatError(err) }, { status: 500 });
      }
    }

    if (url.pathname === "/disconnect" && request.method === "POST") {
      if (!isAdmin(request, env)) return unauthorized();
      return Response.json(await gatewayStub(env).disconnect());
    }

    if (url.pathname === "/status") {
      if (!isAdmin(request, env)) return unauthorized();
      return Response.json(await gatewayStub(env).status());
    }

    if (url.pathname === "/webhook" && request.method === "POST") {
      return handleWebhook(request, env, ctx);
    }

    return new Response("not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

async function handleWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (request.headers.get("x-discord-gateway-token") !== env.DISCORD_GATEWAY_SECRET) {
    return unauthorized();
  }

  const event = (await request.json()) as { type?: string; data?: unknown };
  if (event.type !== "GATEWAY_MESSAGE_CREATE") {
    return new Response("ignored");
  }

  const message = event.data as DiscordMessage | undefined;
  if (!message?.author || message.author.bot || !env.DISCORD_APPLICATION_ID) {
    return new Response("ignored");
  }

  const dedupe = env.DEDUPE.get(env.DEDUPE.idFromName("messages"));
  if (await dedupe.seen(message.id)) {
    return new Response("duplicate");
  }

  const mentioned = isBotMentioned(message, env.DISCORD_APPLICATION_ID);
  ctx.waitUntil(
    handleMessage(message, env, mentioned).catch((err) => {
      console.error("handle message failed", message.id, err);
    }),
  );
  return new Response("ok");
}

/** 全メッセージをログに残し、メンションされたら直近の文脈つきで返信する。 */
async function handleMessage(
  message: DiscordMessage,
  env: Env,
  mentioned: boolean,
): Promise<void> {
  const conversation = env.CONVERSATION.get(env.CONVERSATION.idFromName("log"));
  await conversation.append({
    id: message.id,
    channelId: message.channel_id,
    authorId: message.author.id,
    authorName:
      message.author.global_name ?? message.author.username ?? message.author.id,
    isBot: false,
    content: message.content,
    createdAt: Date.now(),
  });

  if (!mentioned) return;

  const discord = new DiscordClient({ token: env.DISCORD_BOT_TOKEN });
  const context = await conversation.context(message.channel_id, RECENT_MESSAGES);

  await discord.triggerTyping(message.channel_id);
  const reply = await chat({
    apiKey: env.AI_GATEWAY_API_KEY,
    baseUrl: env.AI_GATEWAY_BASE_URL,
    model: models.chat,
    messages: buildPrompt(context, {
      botId: env.DISCORD_APPLICATION_ID,
      system: SYSTEM_PROMPT,
    }),
  });
  await discord.postMessage(message.channel_id, reply, { replyTo: message.id });

  // 返信もログに残して次のターンの文脈にする。1メッセージに1返信なので合成IDで足りる。
  await conversation.append({
    id: `${message.id}:reply`,
    channelId: message.channel_id,
    authorId: env.DISCORD_APPLICATION_ID,
    authorName: "bot",
    isBot: true,
    content: reply,
    createdAt: Date.now(),
  });
}

function gatewayStub(env: Env) {
  return env.DISCORD_GATEWAY.get(env.DISCORD_GATEWAY.idFromName("default"));
}

function isAdmin(request: Request, env: Env): boolean {
  return request.headers.get("x-admin-secret") === env.ADMIN_SECRET;
}

function formatError(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

function unauthorized(): Response {
  return new Response("unauthorized", { status: 401 });
}
