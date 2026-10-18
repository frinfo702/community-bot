import { describe, expect, it, vi } from "vitest";
import { JevClient, jevFor } from "../src/jev";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function client(fetchFn: unknown, baseUrl?: string): JevClient {
  return new JevClient({
    apiKey: "k",
    model: "typesafe-ai/jev",
    fetchFn: fetchFn as typeof fetch,
    baseUrl,
  });
}

describe("JevClient", () => {
  it("sends a typed choice question and returns the selected option", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        answers: {
          q: {
            type: "choice",
            choice: "text",
            confidence: 0.9,
            probabilities: { stamp: 0.1, text: 0.9 },
          },
        },
      }),
    );

    const result = await client(fetchFn).choice(
      { message: "なるほど" },
      {
        instructions: "どう反応するか",
        criteria: { stamp: "絵文字だけで足りる", text: "文章で返す" },
      },
    );

    expect(result).toEqual({
      ok: true,
      value: {
        choice: "text",
        confidence: 0.9,
        probabilities: { stamp: 0.1, text: 0.9 },
      },
    });

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://ai-gateway.vercel.sh/typesafe/systemone");
    expect(init.headers.Authorization).toBe("Bearer k");
    expect(JSON.parse(init.body)).toEqual({
      model: "typesafe-ai/jev",
      state: { message: "なるほど" },
      questions: {
        q: {
          type: "choice",
          instructions: "どう反応するか",
          criteria: { stamp: "絵文字だけで足りる", text: "文章で返す" },
        },
      },
    });
  });

  it("accepts a custom base URL", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { answers: { q: { type: "noul", noul: 0.8 } } }),
      );

    await client(fetchFn, "https://gateway.test/v1/").boolean("...", {
      instructions: "緊急か",
    });

    expect(fetchFn.mock.calls[0][0]).toBe("https://gateway.test/v1/systemone");
  });

  it("returns a boolean question as a probability", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { answers: { q: { type: "noul", noul: 0.82 } } }),
      );

    const result = await client(fetchFn).boolean("...", {
      instructions: "緊急か",
      criteria: { true: "急ぎ", false: "急ぎではない" },
    });

    expect(result).toEqual({ ok: true, value: { probability: 0.82 } });
  });

  it("returns a score on the rubric", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        answers: { q: { type: "score", score: 1.99, confidence: 0.99 } },
      }),
    );

    const result = await client(fetchFn).score("...", {
      instructions: "緊急度",
      criteria: ["低い", "中くらい", "高い"],
    });

    expect(result).toEqual({ ok: true, value: { score: 1.99, confidence: 0.99 } });
  });

  it("distinguishes a timeout", async () => {
    const timeout = Object.assign(new Error("aborted due to timeout"), {
      name: "TimeoutError",
    });
    const fetchFn = vi.fn().mockRejectedValue(timeout);

    const result = await client(fetchFn).score("...", {
      instructions: "緊急度",
      criteria: ["低い", "高い"],
    });

    expect(result).toEqual({ ok: false, error: "timeout" });
  });

  it("returns unavailable for a network failure", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

    const result = await client(fetchFn).boolean("...", { instructions: "緊急か" });

    expect(result).toMatchObject({ ok: false, error: "unavailable" });
  });

  it("returns unavailable when the service answers with an error status", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse(503, { error: { message: "down" } }));

    const result = await client(fetchFn).boolean("...", { instructions: "緊急か" });

    expect(result).toMatchObject({ ok: false, error: "unavailable" });
    if (!result.ok) expect(result.detail).toContain("503");
  });

  it("rejects an option outside the criteria", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        answers: { q: { type: "choice", choice: "image" } },
      }),
    );

    const result = await client(fetchFn).choice("...", {
      instructions: "どう反応するか",
      criteria: { stamp: "...", text: "..." },
    });

    expect(result).toMatchObject({ ok: false, error: "unavailable" });
  });
});

describe("jevFor", () => {
  it("asks the gateway's TypeSafe API with the gateway key and model", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        answers: { q: { type: "choice", choice: "yes" } },
      }),
    );
    const original = globalThis.fetch;
    globalThis.fetch = fetchFn as unknown as typeof fetch;

    try {
      const client = jevFor({
        AI_GATEWAY_API_KEY: "k",
        DECIDE_MODEL: "typesafe-ai/jev-test",
      });
      await client.choice({ message: "hi" }, {
        instructions: "どうするか",
        criteria: { yes: "はい", no: "いいえ" },
      });

      const [url, init] = fetchFn.mock.calls[0];
      expect(url).toBe("https://ai-gateway.vercel.sh/typesafe/systemone");
      expect(init.headers.Authorization).toBe("Bearer k");
      expect(JSON.parse(init.body).model).toBe("typesafe-ai/jev-test");
    } finally {
      globalThis.fetch = original;
    }
  });
});
