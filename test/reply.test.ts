import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import type { LoggedMessage } from "../src/prompt";
import { replyWithText, retryInstruction, type ReplyRequest } from "../src/reply";

/** One Discord API call the stub saw. */
interface DiscordCall {
  method: string;
  path: string;
  body: Record<string, unknown>;
}

/** Every endpoint the reply path talks to: the AI gateway, Jev and the Discord API. */
function fakeEnv(options: {
  /** One completion per chat call; the last one repeats when the list runs out */
  completion: string | string[];
  calls: LoggedMessage[];
  discord: DiscordCall[];
  prompt?: unknown[];
  /** The messages of every chat call, oldest call first */
  chats?: unknown[][];
  /** Jev's answer for one state. Defaults to 0 (no). */
  jev?: (state: string) => number;
  rejections?: unknown[];
}): Env {
  const completions = Array.isArray(options.completion)
    ? [...options.completion]
    : [options.completion];
  // The last completion answers again when the list runs out
  const fallback = completions.at(-1) ?? "";
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
    recordReplyRejection: async (rejection: unknown) => {
      options.rejections?.push(rejection);
    },
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : {};

    if (url.includes("/systemone")) {
      const state = (body as { state: string }).state;
      const noul = options.jev ? options.jev(state) : 0;
      return json({ answers: { q: { type: "noul", noul } } });
    }
    if (url.includes("/chat/completions")) {
      const request = JSON.parse(String(init?.body)) as { messages: unknown[] };
      options.prompt?.push(...request.messages);
      options.chats?.push(request.messages);
      return json({
        choices: [{ message: { content: completions.shift() ?? fallback } }],
      });
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
    JEV_API_KEY: "jev-key",
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

/** The system blocks of one chat call, oldest first. */
function systemsOf(messages: unknown[]): string[] {
  return messages
    .filter((message) => (message as { role: string }).role === "system")
    .map((message) => (message as { content: string }).content);
}

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

    const systems = systemsOf(prompt);
    expect(systems.at(-2)).toContain("===");
    expect(systems.at(-1)).toContain("八千代");
  });

  it("cuts the repeated line, asks the model again, and keeps the withheld reply", async () => {
    const calls: LoggedMessage[] = [];
    const discord: DiscordCall[] = [];
    const rejections: unknown[] = [];
    const chats: unknown[][] = [];
    const env = fakeEnv({
      completion: [
        "それはよかったのう。\nそれより昼餉は食うたのか。",
        "昨日は奨学金の話をしたのじゃ。",
      ],
      calls,
      discord,
      rejections,
      chats,
      // Only the closing line repeats what the bot had already said
      jev: (state) => (state.includes("昼餉") ? 0.9 : 0.1),
    });

    const logged = await replyWithText(env, request);

    expect(logged.map((message) => message.content)).toEqual([
      "昨日は奨学金の話をしたのじゃ。",
    ]);
    expect(rejections).toEqual([
      {
        messageId: "msg-1",
        channelId: "chan-1",
        gate: "repeat",
        reason: "repeats the preceding turn (p=0.90)",
        text: "それはよかったのう。\nそれより昼餉は食うたのか。",
      },
    ]);
    // The retry carries the withheld reply and the number of cut lines, and the
    // persona stays the last thing the model reads
    const systems = systemsOf(chats[1]);
    expect(systems.at(-2)).toContain("それより昼餉は食うたのか。");
    expect(systems.at(-2)).toContain("===");
    expect(systems.at(-1)).toContain("八千代");
  });

  it("posts nothing when the whole reply repeated the conversation", async () => {
    const calls: LoggedMessage[] = [];
    const discord: DiscordCall[] = [];
    const rejections: unknown[] = [];
    const env = fakeEnv({
      completion: "それより昼餉は食うたのか。",
      calls,
      discord,
      rejections,
      jev: () => 0.9,
    });

    const logged = await replyWithText(env, request);

    expect(logged).toEqual([]);
    expect(calls).toEqual([]);
    expect(
      discord.filter((call) => call.method === "POST" && call.path.endsWith("/messages")),
    ).toEqual([]);
    expect(rejections).toHaveLength(2);
  });
});

describe("retryInstruction", () => {
  it("names the withheld reply and the lines cut from it", () => {
    const instruction = retryInstruction({
      text: "うむ。",
      withheld: "うむ。それより昼餉は食うたのか。",
      cut: ["それより昼餉は食うたのか。"],
    });

    expect(instruction).toContain("それより昼餉は食うたのか。");
    expect(instruction).toContain("うむ。");
    expect(instruction).toContain("do not repeat a line");
  });

  it("leaves out the cut line and the draft when there is none", () => {
    const instruction = retryInstruction({
      text: "",
      withheld: "うむ。",
      cut: [],
    });

    expect(instruction).not.toContain("cut from it");
    expect(instruction).not.toContain("The reply so far");
  });
});
