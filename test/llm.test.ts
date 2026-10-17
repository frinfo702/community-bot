import { describe, expect, it, vi } from "vitest";
import { chat, chatFor, chatWithUsage } from "../src/llm";

describe("chat", () => {
  it("sends the messages as-is and trims the completion", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: " はい " } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const messages = [
      { role: "system" as const, content: "指示" },
      { role: "user" as const, content: "ken: きいて" },
    ];
    const text = await chat({
      apiKey: "k",
      model: "anthropic/claude-haiku-5.5",
      messages,
      baseUrl: "https://example.test/v1",
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(text).toBe("はい");
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://example.test/v1/chat/completions");
    expect(JSON.parse(init.body).messages).toEqual(messages);
    expect(init.headers.Authorization).toBe("Bearer k");
  });

  it("returns usage alongside the text for cost logging", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "yes" } }],
          usage: { prompt_tokens: 10, completion_tokens: 2 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await chatWithUsage({
      apiKey: "k",
      model: "m",
      messages: [{ role: "user", content: "hi" }],
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(result.text).toBe("yes");
    expect(result.usage).toEqual({ prompt_tokens: 10, completion_tokens: 2 });
  });
});

describe("chatFor", () => {
  it("binds the key, base URL and model from the environment", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const original = globalThis.fetch;
    globalThis.fetch = fetchFn as unknown as typeof fetch;

    try {
      await chatFor({
        AI_GATEWAY_API_KEY: "k",
        AI_GATEWAY_BASE_URL: "https://gw.test/v1",
        // An empty override falls back to the code default
        CHAT_MODEL: "",
      })([{ role: "user", content: "hi" }]);

      const [url, init] = fetchFn.mock.calls[0];
      expect(url).toBe("https://gw.test/v1/chat/completions");
      expect(init.headers.Authorization).toBe("Bearer k");
      expect(JSON.parse(init.body).model).toBe("anthropic/claude-haiku-5.5");
    } finally {
      globalThis.fetch = original;
    }
  });
});
