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
  /** Non-200 status for message edits, to exercise the post fallback */
  editStatus?: number;
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
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : {};

    if (url.includes("/chat/completions")) {
      if (options.prompt) {
        const request = JSON.parse(String(init?.body)) as { messages: unknown[] };
        options.prompt.push(...request.messages);
      }
      return json({ choices: [{ message: { content: options.completion } }] });
    }
    if (url.includes("/typing")) {
      options.discord.push({ method, path: url, body });
      return new Response(null, { status: 204 });
    }
    if (url.endsWith("/messages")) {
      options.discord.push({ method, path: url, body });
      return json({ id: `posted-${options.discord.length}` });
    }
    options.discord.push({ method, path: url, body });
    if (options.editStatus && method === "PATCH") {
      return new Response(JSON.stringify({ message: "no" }), {
        status: options.editStatus,
      });
    }
    return json({ id: "edited" });
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

    const { logged } = await replyWithText(env, request);

    const posts = discord.filter((call) => call.method === "POST" && call.path.endsWith("/messages"));
    expect(posts).toHaveLength(1);
    expect(posts[0].body.content).toBe("それはのう、こうじゃ");
    expect(logged.id).toBe("msg-1:reply:0");
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

    await replyWithText(env, request);

    const posts = discord.filter((call) => call.method === "POST" && call.path.endsWith("/messages"));
    expect(posts).toHaveLength(2);
    expect(posts[0].body.content).toBe("まずは結論じゃ");
    expect(posts[1].body.content).toBe("詳しい話はこうじゃ");
    expect(posts[1].body.message_reference).toBeUndefined();
    expect(calls.map((message) => message.id)).toEqual([
      "msg-1:reply:0",
      "msg-1:reply:1",
    ]);
  });

  it("edits the placeholder with the first part instead of posting it", async () => {
    const calls: LoggedMessage[] = [];
    const discord: DiscordCall[] = [];
    const env = fakeEnv({
      completion: "調べたぞ\n===\n詳しくはこれじゃ",
      calls,
      discord,
    });

    await replyWithText(env, {
      ...request,
      placeholder: { channelId: "chan-1", messageId: "ack-1" },
    });

    const edits = discord.filter((call) => call.method === "PATCH");
    expect(edits).toHaveLength(1);
    expect(edits[0].path).toBe(
      "https://discord.com/api/v10/channels/chan-1/messages/ack-1",
    );
    expect(edits[0].body.content).toBe("調べたぞ");
    const posts = discord.filter((call) => call.method === "POST" && call.path.endsWith("/messages"));
    expect(posts).toHaveLength(1);
    expect(posts[0].body.content).toBe("詳しくはこれじゃ");
  });

  it("posts a new message when the placeholder edit fails", async () => {
    const calls: LoggedMessage[] = [];
    const discord: DiscordCall[] = [];
    const env = fakeEnv({
      completion: "答えじゃ",
      calls,
      discord,
      editStatus: 404,
    });

    await replyWithText(env, {
      ...request,
      placeholder: { channelId: "chan-1", messageId: "ack-1" },
    });

    const edits = discord.filter((call) => call.method === "PATCH");
    expect(edits).toHaveLength(1);
    const posts = discord.filter((call) => call.method === "POST" && call.path.endsWith("/messages"));
    expect(posts).toHaveLength(1);
    expect(posts[0].body.content).toBe("答えじゃ");
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
