import { ConversationDO } from "./conversation";
import { decideReplyForm, decideStampEmoji } from "./decisions";
import { DedupeDO } from "./dedupe";
import { DiscordClient } from "./discord/client";
import {
  isBotMentioned,
  stripBotMentions,
  type DiscordMessage,
} from "./discord/mention";
import type { Env } from "./env";
import { GatewayDO } from "./gateway";
import { generateImage } from "./image";
import { JevClient } from "./jev";
import { chat } from "./llm";
import { models } from "./models";
import { renderPersona } from "./persona";
import { JUDGE_QUESTION, runProbes, type ProbeReport } from "./probes";
import { buildPrompt } from "./prompt";
import { SandboxContainer } from "./sandbox";
import { executeTask, summarizePage } from "./task";

export { GatewayDO, DedupeDO, ConversationDO, SandboxContainer };

// Number of recent messages included in the reply prompt
const RECENT_MESSAGES = 20;

// Cap on the speaker's memories included in the reply prompt
const PROFILE_MEMORIES = 10;

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
        // Return DO-side exceptions as readable JSON instead of a 1101 HTML error page
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

    if (url.pathname === "/probe" && request.method === "POST") {
      if (!isAdmin(request, env)) return unauthorized();
      try {
        return Response.json(await runPersonaProbes(env));
      } catch (err) {
        console.error("probe failed", err);
        return Response.json({ error: formatError(err) }, { status: 500 });
      }
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

/** Log every message, and reply with the recent context when the bot is mentioned. */
async function handleMessage(
  message: DiscordMessage,
  env: Env,
  mentioned: boolean,
): Promise<void> {
  const conversation = env.CONVERSATION.get(env.CONVERSATION.idFromName("log"));
  const authorName =
    message.author.global_name ?? message.author.username ?? message.author.id;
  await conversation.append({
    id: message.id,
    channelId: message.channel_id,
    authorId: message.author.id,
    authorName,
    isBot: false,
    content: message.content,
    createdAt: Date.now(),
  });

  if (!mentioned) return;

  const discord = new DiscordClient({ token: env.DISCORD_BOT_TOKEN });
  const context = await conversation.context(message.channel_id, RECENT_MESSAGES);
  const jev = new JevClient({
    apiKey: env.JEV_API_KEY,
    model: models.decide,
    baseUrl: env.JEV_BASE_URL,
  });

  const form = await decideReplyForm(jev, context, env.DISCORD_APPLICATION_ID);
  // Jev does not return a reason in prose, so log the decision together with confidence / probabilities
  console.log("reply form", message.id, JSON.stringify(form));
  if (form.form === "stamp") {
    const stamp = await decideStampEmoji(jev, context, env.DISCORD_APPLICATION_ID);
    console.log("stamp", message.id, JSON.stringify(stamp));
    await discord.addReaction(message.channel_id, message.id, stamp.emoji);
    return;
  }

  if (form.form === "image") {
    const prompt =
      stripBotMentions(message.content, env.DISCORD_APPLICATION_ID) || "(本文なし)";
    const startedAt = Date.now();
    const image = await generateImage({
      apiKey: env.AI_GATEWAY_API_KEY,
      baseUrl: env.AI_GATEWAY_BASE_URL,
      model: models.image,
      prompt,
    });
    // Log the model used, elapsed time, and usage (a clue to cost)
    console.log(
      "image generated",
      message.id,
      JSON.stringify({
        model: models.image,
        ms: Date.now() - startedAt,
        usage: image.usage,
      }),
    );
    await discord.postImage(message.channel_id, image, { replyTo: message.id });
    await conversation.append({
      id: `${message.id}:image`,
      channelId: message.channel_id,
      authorId: env.DISCORD_APPLICATION_ID,
      authorName: "bot",
      isBot: true,
      content: "[画像を投稿した]",
      createdAt: Date.now(),
    });
    return;
  }
  if (form.form === "task") {
    const startedAt = Date.now();
    const task = await executeTask(message.content, {
      fetchText: (url) => env.SANDBOX.getByName("task").fetchText(url),
      summarize: (url, page) =>
        summarizePage({
          apiKey: env.AI_GATEWAY_API_KEY,
          baseUrl: env.AI_GATEWAY_BASE_URL,
          model: models.chat,
          url,
          page,
        }),
    });
    if (task) {
      // Model, duration and usage are the cost hints for this run.
      console.log(
        "task executed",
        message.id,
        JSON.stringify({
          url: task.url,
          model: models.chat,
          ms: Date.now() - startedAt,
          sandboxMs: task.sandboxMs,
          usage: task.usage,
        }),
      );
      await discord.postMessage(message.channel_id, task.summary, {
        replyTo: message.id,
      });
      await conversation.append({
        id: `${message.id}:task`,
        channelId: message.channel_id,
        authorId: env.DISCORD_APPLICATION_ID,
        authorName: "bot",
        isBot: true,
        content: task.summary,
        createdAt: Date.now(),
      });
      return;
    }
    // A task that cannot run falls through to the text reply below.
  }

  const profile = await conversation.memories(
    message.author.id,
    PROFILE_MEMORIES,
    "reply",
  );
  await discord.triggerTyping(message.channel_id);
  const reply = await chat({
    apiKey: env.AI_GATEWAY_API_KEY,
    baseUrl: env.AI_GATEWAY_BASE_URL,
    model: models.chat,
    messages: buildPrompt(context, {
      botId: env.DISCORD_APPLICATION_ID,
      persona: renderPersona(),
      profile: { name: authorName, memories: profile.map((m) => m.content) },
    }),
  });
  await discord.postMessage(message.channel_id, reply, { replyTo: message.id });

  // Log the reply too so it becomes context for the next turn. One reply per message, so a synthetic ID is enough.
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

/** Run the persona probes with the same prompt as production (ISSUE-1880). */
async function runPersonaProbes(env: Env): Promise<ProbeReport> {
  const jev = new JevClient({
    apiKey: env.JEV_API_KEY,
    model: models.decide,
    baseUrl: env.JEV_BASE_URL,
  });

  const report = await runProbes({
    generate: (probe) =>
      chat({
        apiKey: env.AI_GATEWAY_API_KEY,
        baseUrl: env.AI_GATEWAY_BASE_URL,
        model: models.chat,
        messages: buildPrompt(
          {
            summary: null,
            messages: [
              {
                id: probe.id,
                channelId: "probe",
                authorId: "probe",
                authorName: "probe",
                isBot: false,
                content: probe.message,
                createdAt: 0,
              },
            ],
          },
          { botId: env.DISCORD_APPLICATION_ID, persona: renderPersona() },
        ),
      }),
    judge: async (probe, reply) => {
      const result = await jev.choice(
        { probe: probe.message, reply },
        JUDGE_QUESTION,
      );
      return result.ok ? result.value.choice : null;
    },
  });

  // Also log the deviation rate
  console.log(
    "persona probe",
    JSON.stringify({
      total: report.total,
      judged: report.judged,
      deviationRate: report.deviationRate,
      counts: report.counts,
    }),
  );
  return report;
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
