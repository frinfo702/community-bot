import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import type { LoggedMessage } from "../src/prompt";
import { replyWithText, type ReplyRequest } from "../src/reply";

/** One Discord API call the stub saw. */
interface DiscordCall {
  method: string;
  path: string;
  body: Record<string, unknown>;
}

/** Both endpoints the reply path talks to: the AI gateway and the Discord API. */
function fakeEnv(options: {
  completion: string;
  calls: LoggedMessage[];
  discord: DiscordCall[];
  prompt?: unknown[];
}): Env {
  const conversation = {
    context: async () => ({
      summary: null,
      messages: [
        {
          id: "msg-1",
          channelId: "chan-1",
          authorId: "u1",
          authorName: "ken",
          isBot: false,
          content: "これ調べて",
          createdAt: 1,
        },
      ],
    }),
    memories: async () => [],
    activeStyle: async () => null,
    append: async (message: LoggedMessage) => {
      options.calls.push(message);
    },
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : {};

    if (url.includes("/chat/completions")) {
      if (options.prompt) {
        const request = JSON.parse(String(init?.body)) as { messages: unknown[] };
        options.prompt.push(...request.messages);
      }
      return json({ choices: [{ message: { content: options.completion } }] });
    }
    options.discord.push({ method, path: url, body });
    return url.includes("/typing")
      ? new Response(null, { status: 204 })
      : json({ id: `posted-${options.discord.length}` });
  }) as typeof fetch;

  return {
    CONVERSATION: {
      idFromName: (name: string) => name,
      get: () => conversation,
    },
    DISCORD_BOT_TOKEN: "token",
    DISCORD_APPLICATION_ID: "bot-1",
    AI_GATEWAY_API_KEY: "key",
  } as unknown as Env;
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const request: ReplyRequest = {
  channelId: "chan-1",
  messageId: "msg-1",
  authorId: "u1",
  authorName: "ken",
  quote: false,
};

describe("replyWithText", () => {
  it("posts one message and logs it when the model does not split", async () => {
    const calls: LoggedMessage[] = [];
    const discord: DiscordCall[] = [];
    const env = fakeEnv({ completion: "それはのう、こうじゃ", calls, discord });

    const logged = await replyWithText(env, request);

    const posts = discord.filter(
      (call) => call.method === "POST" && call.path.endsWith("/messages"),
    );
    expect(posts).toHaveLength(1);
    expect(posts[0].body.content).toBe("それはのう、こうじゃ");
    expect(logged.map((message) => message.id)).toEqual(["msg-1:reply:0"]);
    expect(calls.map((message) => message.id)).toEqual(["msg-1:reply:0"]);
  });

  it("posts the later parts as new messages after the first", async () => {
    const calls: LoggedMessage[] = [];
    const discord: DiscordCall[] = [];
    const env = fakeEnv({
      completion: "まずは結論じゃ\n===\n詳しい話はこうじゃ",
      calls,
      discord,
    });

    const logged = await replyWithText(env, request);

    const posts = discord.filter(
      (call) => call.method === "POST" && call.path.endsWith("/messages"),
    );
    expect(posts).toHaveLength(2);
    expect(posts[0].body.content).toBe("まずは結論じゃ");
    expect(posts[1].body.content).toBe("詳しい話はこうじゃ");
    expect(posts[1].body.message_reference).toBeUndefined();
    expect(logged.map((message) => message.id)).toEqual([
      "msg-1:reply:0",
      "msg-1:reply:1",
    ]);
  });

  it("quotes the request on the first part only", async () => {
    const calls: LoggedMessage[] = [];
    const discord: DiscordCall[] = [];
    const env = fakeEnv({
      completion: "まずはこれじゃ\n===\n続きじゃ",
      calls,
      discord,
    });

    await replyWithText(env, { ...request, quote: true });

    const posts = discord.filter(
      (call) => call.method === "POST" && call.path.endsWith("/messages"),
    );
    expect(posts[0].body.message_reference).toEqual({
      message_id: "msg-1",
      fail_if_not_exists: false,
    });
    expect(posts[1].body.message_reference).toBeUndefined();
  });

  it("returns every part for the caller to reuse", async () => {
    const calls: LoggedMessage[] = [];
    const discord: DiscordCall[] = [];
    const env = fakeEnv({
      completion: "一\n===\n二\n===\n三",
      calls,
      discord,
    });

    const logged = await replyWithText(env, request);

    expect(logged.map((message) => message.content)).toEqual(["一", "二", "三"]);
    expect(calls).toHaveLength(3);
  });

  it("tells the model about the split marker, before the persona", async () => {
    const calls: LoggedMessage[] = [];
    const discord: DiscordCall[] = [];
    const prompt: unknown[] = [];
    const env = fakeEnv({ completion: "はい", calls, discord, prompt });

    await replyWithText(env, request);

    const systems = prompt.filter(
      (message) => (message as { role: string }).role === "system",
    ) as Array<{ content: string }>;
    expect(systems.at(-2)?.content).toContain("===");
    expect(systems.at(-1)?.content).toContain("八千代");
  });
});
