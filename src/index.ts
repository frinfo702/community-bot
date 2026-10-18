import { acknowledgeTask } from "./ack";
import {
  MEMORY_COMMAND,
  memoryStore,
  parseMemoryCommand,
  runMemoryCommand,
  sendMemoryList,
} from "./commands";
import { TaskAgent } from "./agent";
import { ConversationDO } from "./conversation";
import {
  decideComplexTask,
  decideEmojiOnly,
  decideQuoteReply,
  decideShouldReply,
} from "./decisions";
import { DedupeDO } from "./dedupe";
import { DiscordClient } from "./discord/client";
import {
  imageUrls,
  isBotMentioned,
  quotedLine,
  stripBotMentions,
  type DiscordMessage,
} from "./discord/mention";
import type { Env } from "./env";
import { GatewayDO } from "./gateway";
import { handleInteraction } from "./interactions";
import { jevFor } from "./jev";
import { chatFor } from "./llm";
import { extractMemories } from "./memory";
import { renderPersona } from "./persona";
import { JUDGE_QUESTION, runProbes, type ProbeReport } from "./probes";
import replyRules from "../reply-rules.md";
import {
  buildPrompt,
  buildTaskPrompt,
  PROFILE_MEMORIES,
  RECENT_MESSAGES,
  type ChannelContext,
} from "./prompt";
import { replyWithText } from "./reply";
import { SandboxContainer } from "./sandbox";
import { decideCorrection, reactionTarget } from "./signals";
import { decideStamp, guildStampEmojis, type StampMode } from "./stamp";
import { proposeStyle, runStyleRevision } from "./style";

export { GatewayDO, DedupeDO, ConversationDO, SandboxContainer, TaskAgent };

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

    // Undo the memory changes of one nightly run (ISSUE-1874). runId omitted = the latest run
    if (url.pathname === "/memory/rollback" && request.method === "POST") {
      if (!isAdmin(request, env)) return unauthorized();
      try {
        const body = (await request.json().catch(() => ({}))) as {
          runId?: number;
        };
        const result = await conversationStub(env).rollbackNightlyRun(body.runId);
        if (!result) {
          return Response.json(
            { error: "nightly run not found" },
            { status: 404 },
          );
        }
        console.log("nightly rollback", JSON.stringify(result));
        return Response.json(result, {
          status: result.alreadyRolledBack ? 409 : 200,
        });
      } catch (err) {
        console.error("nightly rollback failed", err);
        return Response.json({ error: formatError(err) }, { status: 500 });
      }
    }

    // Slash commands. Discord signs each request with the app's key, so this path
    // needs no shared secret. Set the URL as the app's Interactions Endpoint URL.
    if (url.pathname === "/interactions" && request.method === "POST") {
      return handleInteraction(request, env);
    }

    // Register the slash commands with Discord (safe to repeat after a deploy)
    if (url.pathname === "/commands/register" && request.method === "POST") {
      if (!isAdmin(request, env)) return unauthorized();
      try {
        await new DiscordClient({
          token: env.DISCORD_BOT_TOKEN,
        }).putGlobalCommands(env.DISCORD_APPLICATION_ID, [MEMORY_COMMAND]);
        return Response.json({ ok: true, commands: [MEMORY_COMMAND.name] });
      } catch (err) {
        console.error("command registration failed", err);
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

/** Log every message, and reply when the bot is mentioned or the reply rules call for it. */
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
    // Keep what this message quotes, so a later "これ" still has its referent
    quoted: quotedLine(message, env.DISCORD_APPLICATION_ID),
    createdAt: Date.now(),
  });

  // Memory text commands work without a mention (ISSUE-1879). `/memory` is the
  // slash equivalent; both end in runMemoryCommand and the same store.
  const memoryCommand = parseMemoryCommand(
    message.content,
    env.DISCORD_APPLICATION_ID,
  );
  if (memoryCommand) {
    const discord = new DiscordClient({ token: env.DISCORD_BOT_TOKEN });
    const reply = await runMemoryCommand(
      memoryCommand,
      message.author.id,
      memoryStore(env),
    );
    // A text command cannot reply ephemerally, so `show` goes to DM to keep the
    // memories away from other members of the channel.
    if (memoryCommand.action === "show") {
      await sendMemoryList(discord, message, reply);
    } else {
      await discord.postMessage(message.channel_id, reply, {
        replyTo: message.id,
      });
    }
    return;
  }

  const jev = jevFor(env);

  // A reply to a bot message is checked for a correction even without a mention (ISSUE-1867)
  const referenced = message.referenced_message;
  if (referenced?.author?.id === env.DISCORD_APPLICATION_ID) {
    const decision = await decideCorrection(
      jev,
      referenced.content,
      stripBotMentions(message.content, env.DISCORD_APPLICATION_ID) || "(no text)",
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

  const context = await conversation.context(message.channel_id, RECENT_MESSAGES);
  if (!mentioned) {
    // Without a mention, reply-rules.md decides whether the bot joins. A reply
    // then takes the same path as a mention.
    const decision = await decideShouldReply(
      jev,
      context,
      env.DISCORD_APPLICATION_ID,
      replyRules,
    );
    console.log("should reply", message.id, JSON.stringify(decision));
    if (!decision.reply) return;
  }

  const discord = new DiscordClient({ token: env.DISCORD_BOT_TOKEN });
  const images = imageUrls(message);

  // Only the written reply can show an image to the model: the task prompt is text and a
  // reaction alone would drop it. So an image message skips the two shortcut decisions
  // (and the Jev calls behind them) and goes straight to the reply below. A skipped
  // shortcut is the same shape as a "no" from Jev, which is also the failed-call default.
  const shortcut = images.length === 0;

  // The three decisions read the same conversation, so they run in parallel and the
  // read receipt for a task can go out before the task starts
  const [emojiOnly, complex, quoteReply] = await Promise.all([
    shortcut
      ? decideEmojiOnly(jev, context, env.DISCORD_APPLICATION_ID)
      : { enough: false, fallback: false },
    shortcut
      ? decideComplexTask(jev, context, env.DISCORD_APPLICATION_ID)
      : { task: false, fallback: false },
    decideQuoteReply(jev, context, env.DISCORD_APPLICATION_ID),
  ]);
  // Jev does not return a reason in prose, so log the decisions together with the probabilities
  if (shortcut) {
    console.log("emoji only", message.id, JSON.stringify(emojiOnly));
    console.log("complex task", message.id, JSON.stringify(complex));
  }
  console.log("quote reply", message.id, JSON.stringify(quoteReply));

  // The reaction is used when the emoji alone is the reply and as the read receipt
  // before a long task. A written reply gets no reaction.
  const stampMode: StampMode | null = emojiOnly.enough
    ? "reply"
    : complex.task
      ? "ack"
      : null;
  if (stampMode) {
    await sendStamp(env, conversation, discord, message, context, stampMode);
  }

  if (emojiOnly.enough) return;

  if (complex.task) {
    const agent = env.TASK_AGENT.getByName(message.channel_id);
    // A task can take minutes, so it starts with a short acknowledgment in the
    // bot's own voice; the answer follows as its own message.
    await acknowledgeTask(env, {
      channelId: message.channel_id,
      messageId: message.id,
      context,
    });
    try {
      // The DO runs the turn and posts the answer itself: the webhook's
      // waitUntil() is cancelled 30 seconds after the response, which a task
      // turn regularly exceeds.
      await agent.startTask({
        prompt: buildTaskPrompt(context, {
          botId: env.DISCORD_APPLICATION_ID,
          authorName,
          now: Date.now(),
        }),
        channelId: message.channel_id,
        messageId: message.id,
        authorId: message.author.id,
        authorName,
        quote: quoteReply.quote,
      });
      return;
    } catch (err) {
      // A task that cannot be dispatched falls through to the text reply below.
      console.error("task dispatch failed", message.id, err);
    }
  }

  const logged = await replyWithText(env, {
    channelId: message.channel_id,
    messageId: message.id,
    authorId: message.author.id,
    authorName,
    images,
    quote: quoteReply.quote,
  });

  // Extract memories asynchronously after the reply (ISSUE-1869). Failures must not affect the reply
  ctx.waitUntil(
    extractMemories(
      { jev, store: conversation, generate: chatFor(env) },
      {
        userId: message.author.id,
        userName: authorName,
        messages: [...context.messages, ...logged],
        botId: env.DISCORD_APPLICATION_ID,
      },
    )
      .then((result) =>
        console.log("memory extraction", message.id, JSON.stringify(result)),
      )
      .catch((err) => console.error("memory extraction failed", message.id, err)),
  );
}

/**
 * Picks the reaction emoji with Jev (cached category rankings) and puts it on the
 * message. A failed reaction must not cost the task or the reply that follows.
 */
async function sendStamp(
  env: Env,
  conversation: DurableObjectStub<ConversationDO>,
  discord: DiscordClient,
  message: DiscordMessage,
  context: ChannelContext,
  mode: StampMode,
): Promise<void> {
  const custom = await guildStampEmojis(
    { discord, store: conversation },
    message.guild_id,
  );
  const stamp = await decideStamp(
    { jev: jevFor(env), store: conversation },
    {
      scope: message.guild_id ?? "dm",
      context,
      botId: env.DISCORD_APPLICATION_ID,
      mode,
      custom,
    },
  );
  console.log("stamp", message.id, JSON.stringify(stamp));
  await discord
    .addReaction(message.channel_id, message.id, stamp.emoji)
    .catch((err) => console.error("reaction failed", message.id, err));
}

function gatewayStub(env: Env) {
  return env.DISCORD_GATEWAY.get(env.DISCORD_GATEWAY.idFromName("default"));
}

function conversationStub(env: Env) {
  return env.CONVERSATION.get(env.CONVERSATION.idFromName("log"));
}

/** Run the persona probes with the same prompt as production (ISSUE-1880). */
async function runPersonaProbes(
  env: Env,
  styleOverride?: string,
): Promise<ProbeReport> {
  const jev = jevFor(env);
  const generate = chatFor(env);

  const report = await runProbes({
    generate: (probe) =>
      generate(
        buildPrompt(
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
            now: Date.now(),
            persona: renderPersona(styleOverride),
          },
        ),
      ),
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
      proposeStyle(signals, currentStyle, { generate: chatFor(env) }),
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
