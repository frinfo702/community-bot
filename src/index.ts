import { parseMemoryCommand, runMemoryCommand, sendMemoryList } from "./commands";
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
import { extractMemories } from "./memory";
import { models } from "./models";
import { renderPersona } from "./persona";
import { JUDGE_QUESTION, runProbes, type ProbeReport } from "./probes";
import { buildPrompt } from "./prompt";
import { decideCorrection, reactionTarget } from "./signals";
import { proposeStyle, runStyleRevision } from "./style";

export { GatewayDO, DedupeDO, ConversationDO };

// Number of recent messages included in the reply prompt
const RECENT_MESSAGES = 20;

// Cap on the speaker's memories included in the reply prompt
const PROFILE_MEMORIES = 10;

// Signal window and cap the style revision (ISSUE-1867) looks at
const SIGNAL_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const SIGNAL_LIMIT = 50;

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

  /** Once a day from Cron Triggers (wrangler.jsonc). Self-revises the style layer only. */
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      runNightlyStyleRevision(env).catch((err) => {
        console.error("style revision failed", err);
      }),
    );
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

  if (event.type === "GATEWAY_MESSAGE_REACTION_ADD") {
    const reaction = reactionTarget(event.data);
    if (!reaction || !env.DISCORD_APPLICATION_ID) {
      return new Response("ignored");
    }
    const conversation = env.CONVERSATION.get(env.CONVERSATION.idFromName("log"));
    const recorded = await conversation.recordReaction(
      reaction.messageId,
      reaction.userId,
      reaction.emoji,
      env.DISCORD_APPLICATION_ID,
    );
    return new Response(recorded ? "ok" : "ignored");
  }

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
    handleMessage(message, env, mentioned, ctx).catch((err) => {
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
  ctx: ExecutionContext,
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

  // Memory commands work without a mention (ISSUE-1879). The gateway does not
  // forward INTERACTION_CREATE, so this is a text command, not a slash command.
  const memoryCommand = parseMemoryCommand(
    message.content,
    env.DISCORD_APPLICATION_ID,
  );
  if (memoryCommand) {
    const discord = new DiscordClient({ token: env.DISCORD_BOT_TOKEN });
    const reply = await runMemoryCommand(memoryCommand, message.author.id, {
      list: (userId, limit) => conversation.memories(userId, limit, "command"),
      forget: (id, userId) => conversation.forgetMemory(id, userId, "command"),
      forgetAll: (userId) => conversation.forgetAllMemories(userId, "command"),
    });
    // Without interactions there is no ephemeral reply, so `show` goes to DM
    // to keep the memories away from other members of the channel.
    if (memoryCommand.action === "show") {
      await sendMemoryList(discord, message, reply);
    } else {
      await discord.postMessage(message.channel_id, reply, {
        replyTo: message.id,
      });
    }
    return;
  }

  const jev = new JevClient({
    apiKey: env.JEV_API_KEY,
    model: models.decide,
    baseUrl: env.JEV_BASE_URL,
  });

  // A reply to a bot message is checked for a correction even without a mention (ISSUE-1867)
  const referenced = message.referenced_message;
  if (referenced?.author?.id === env.DISCORD_APPLICATION_ID) {
    const decision = await decideCorrection(
      jev,
      referenced.content,
      stripBotMentions(message.content, env.DISCORD_APPLICATION_ID) || "(本文なし)",
    );
    // Jev does not return a reason in prose, so log the decision together with the probability
    console.log("correction", message.id, JSON.stringify(decision));
    if (decision.correction) {
      await conversation.recordCorrection(
        referenced.id,
        message.author.id,
        message.content,
      );
    }
  }

  if (!mentioned) return;

  const discord = new DiscordClient({ token: env.DISCORD_BOT_TOKEN });
  const context = await conversation.context(message.channel_id, RECENT_MESSAGES);

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
  // task is not implemented yet, so fall back to a text reply for now

  const profile = await conversation.memories(
    message.author.id,
    PROFILE_MEMORIES,
    "reply",
  );
  // Reflect the style override set by the nightly revision (ISSUE-1867). The core stays persona.md
  const styleOverride = await conversation.activeStyle();
  await discord.triggerTyping(message.channel_id);
  const reply = await chat({
    apiKey: env.AI_GATEWAY_API_KEY,
    baseUrl: env.AI_GATEWAY_BASE_URL,
    model: models.chat,
    messages: buildPrompt(context, {
      botId: env.DISCORD_APPLICATION_ID,
      persona: renderPersona(styleOverride ?? undefined),
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

  // Extract memories asynchronously after the reply (ISSUE-1869). Failures must not affect the reply
  ctx.waitUntil(
    extractMemories(
      {
        jev,
        store: conversation,
        generate: (messages) =>
          chat({
            apiKey: env.AI_GATEWAY_API_KEY,
            baseUrl: env.AI_GATEWAY_BASE_URL,
            model: models.chat,
            messages,
          }),
      },
      {
        userId: message.author.id,
        userName: authorName,
        messages: [
          ...context.messages,
          {
            id: `${message.id}:reply`,
            channelId: message.channel_id,
            authorId: env.DISCORD_APPLICATION_ID,
            authorName: "bot",
            isBot: true,
            content: reply,
            createdAt: Date.now(),
          },
        ],
        botId: env.DISCORD_APPLICATION_ID,
      },
    )
      .then((result) =>
        console.log("memory extraction", message.id, JSON.stringify(result)),
      )
      .catch((err) => console.error("memory extraction failed", message.id, err)),
  );
}

function gatewayStub(env: Env) {
  return env.DISCORD_GATEWAY.get(env.DISCORD_GATEWAY.idFromName("default"));
}

/** Run the persona probes with the same prompt as production (ISSUE-1880). */
async function runPersonaProbes(
  env: Env,
  styleOverride?: string,
): Promise<ProbeReport> {
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
          {
            botId: env.DISCORD_APPLICATION_ID,
            persona: renderPersona(styleOverride),
          },
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

/** Nightly style revision (ISSUE-1867). Builds a revision from recent signals and applies it only when it does not worsen the probes. */
async function runNightlyStyleRevision(env: Env): Promise<void> {
  const conversation = env.CONVERSATION.get(env.CONVERSATION.idFromName("log"));
  const signals = await conversation.recentSignals(
    Date.now() - SIGNAL_LOOKBACK_MS,
    SIGNAL_LIMIT,
  );

  await runStyleRevision({
    signals,
    currentStyle: await conversation.activeStyle(),
    propose: (signals, currentStyle) =>
      proposeStyle(signals, currentStyle, {
        generate: (messages) =>
          chat({
            apiKey: env.AI_GATEWAY_API_KEY,
            baseUrl: env.AI_GATEWAY_BASE_URL,
            model: models.chat,
            messages,
          }),
      }),
    probe: (style) => runPersonaProbes(env, style),
    record: (revision) => conversation.recordStyleRevision(revision),
    log: (message) => console.log("style revision", message),
  });
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
