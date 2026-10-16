import { DedupeDO } from "./dedupe";
import { DiscordClient } from "./discord/client";
import {
  isBotMentioned,
  stripBotMentions,
  type DiscordMessage,
} from "./discord/mention";
import type { Env } from "./env";
import { GatewayDO } from "./gateway";
import { chat } from "./llm";

export { GatewayDO, DedupeDO };

// 暫定のシステムプロンプト。persona.md の導入（ISSUE-1865）で置き換える。
const SYSTEM_PROMPT =
  "あなたは4人の大学院生のDiscordサーバーに住むAIメンバー。親しみやすいタメ口で、長すぎない返事をする。";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return new Response("community-bot");
    }

    if (url.pathname === "/connect" && request.method === "POST") {
      if (!isAdmin(request, env)) return unauthorized();
      return Response.json(
        await gatewayStub(env).start({
          botToken: env.DISCORD_BOT_TOKEN,
          webhookUrl: `${url.origin}/webhook`,
          webhookSecret: env.DISCORD_GATEWAY_SECRET,
        }),
      );
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
  if (!isBotMentioned(message, env.DISCORD_APPLICATION_ID)) {
    return new Response("ignored");
  }

  const dedupe = env.DEDUPE.get(env.DEDUPE.idFromName("messages"));
  if (await dedupe.seen(message.id)) {
    return new Response("duplicate");
  }

  ctx.waitUntil(
    replyToMessage(message, env).catch((err) => {
      console.error("reply failed", message.id, err);
    }),
  );
  return new Response("ok");
}

async function replyToMessage(message: DiscordMessage, env: Env): Promise<void> {
  const discord = new DiscordClient({ token: env.DISCORD_BOT_TOKEN });
  const text = stripBotMentions(message.content, env.DISCORD_APPLICATION_ID);

  await discord.triggerTyping(message.channel_id);
  const reply = await chat({
    apiKey: env.AI_GATEWAY_API_KEY,
    baseUrl: env.AI_GATEWAY_BASE_URL,
    model: env.CHAT_MODEL,
    system: SYSTEM_PROMPT,
    user: text || "(メンションだけが送られた)",
  });
  await discord.postMessage(message.channel_id, reply, { replyTo: message.id });
}

function gatewayStub(env: Env) {
  return env.DISCORD_GATEWAY.get(env.DISCORD_GATEWAY.idFromName("default"));
}

function isAdmin(request: Request, env: Env): boolean {
  return request.headers.get("x-admin-secret") === env.ADMIN_SECRET;
}

function unauthorized(): Response {
  return new Response("unauthorized", { status: 401 });
}
