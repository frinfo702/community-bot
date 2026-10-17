import { describe, expect, it, vi } from "vitest";
import {
  COMPLEX_TASK_THRESHOLD,
  decideComplexTask,
  decideEmojiOnly,
  EMOJI_ONLY_THRESHOLD,
} from "../src/decisions";
import { JevClient } from "../src/jev";
import type { ChannelContext, LoggedMessage } from "../src/prompt";

const BOT = "1234567890";

function jevClient(fetchFn: unknown): JevClient {
  return new JevClient({
    apiKey: "k",
    model: "jev-latest",
    fetchFn: fetchFn as typeof fetch,
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function message(partial: Partial<LoggedMessage>): LoggedMessage {
  return {
    id: "1",
    channelId: "c1",
    authorId: "u1",
    authorName: "ken",
    isBot: false,
    content: "",
    createdAt: 0,
    ...partial,
  };
}

function context(messages: LoggedMessage[]): ChannelContext {
  return { summary: null, messages };
}

function booleanResponse(probability: number): Response {
  return jsonResponse(200, {
    answers: { q: { type: "noul", noul: probability } },
  });
}

describe("decideEmojiOnly", () => {
  it("treats a probability above the threshold as an emoji-only reply", async () => {
    const fetchFn = vi.fn().mockResolvedValue(booleanResponse(0.8));

    const decision = await decideEmojiOnly(
      jevClient(fetchFn),
      context([message({ content: "それな" })]),
      BOT,
    );

    expect(decision).toEqual({ enough: true, fallback: false, probability: 0.8 });
  });

  it("treats a probability below the threshold as needing a written reply", async () => {
    const fetchFn = vi.fn().mockResolvedValue(booleanResponse(0.2));

    const decision = await decideEmojiOnly(
      jevClient(fetchFn),
      context([message({ content: "ただいま〜" })]),
      BOT,
    );

    expect(decision).toEqual({
      enough: false,
      fallback: false,
      probability: 0.2,
    });
  });

  it("counts the threshold itself as enough", async () => {
    const fetchFn = vi.fn().mockResolvedValue(booleanResponse(EMOJI_ONLY_THRESHOLD));

    const decision = await decideEmojiOnly(
      jevClient(fetchFn),
      context([message({ content: "それな" })]),
      BOT,
    );

    expect(decision.enough).toBe(true);
  });

  it("passes the recent conversation as the state", async () => {
    const fetchFn = vi.fn().mockResolvedValue(booleanResponse(0.9));

    await decideEmojiOnly(
      jevClient(fetchFn),
      context([
        message({ id: "1", content: "やあ" }),
        message({ id: "2", isBot: true, authorName: "bot", content: "どうした？" }),
        message({ id: "3", content: `<@${BOT}> これ見て` }),
      ]),
      BOT,
    );

    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.state).toBe("ken: やあ\nbot: どうした？\nken: これ見て");
    expect(body.questions.q.type).toBe("noul");
  });

  it("falls back to the written reply when Jev cannot be reached", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

    const decision = await decideEmojiOnly(
      jevClient(fetchFn),
      context([message({ content: "きいて" })]),
      BOT,
    );

    expect(decision).toEqual({ enough: false, fallback: true });
  });
});

describe("decideComplexTask", () => {
  it("treats a probability above the threshold as a task", async () => {
    const fetchFn = vi.fn().mockResolvedValue(booleanResponse(0.75));

    const decision = await decideComplexTask(
      jevClient(fetchFn),
      context([message({ content: "この記事を要約して https://example.com" })]),
      BOT,
    );

    expect(decision).toEqual({ task: true, fallback: false, probability: 0.75 });
  });

  it("counts the threshold itself as a task", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      booleanResponse(COMPLEX_TASK_THRESHOLD),
    );

    const decision = await decideComplexTask(
      jevClient(fetchFn),
      context([message({ content: "調べて" })]),
      BOT,
    );

    expect(decision.task).toBe(true);
  });

  it("treats a probability below the threshold as a written reply", async () => {
    const fetchFn = vi.fn().mockResolvedValue(booleanResponse(0.3));

    const decision = await decideComplexTask(
      jevClient(fetchFn),
      context([message({ content: "それでそれで？" })]),
      BOT,
    );

    expect(decision).toEqual({ task: false, fallback: false, probability: 0.3 });
  });

  it("falls back to the written reply when Jev cannot be reached", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(503, {}));

    const decision = await decideComplexTask(
      jevClient(fetchFn),
      context([message({ content: "これ見て" })]),
      BOT,
    );

    expect(decision).toEqual({ task: false, fallback: true });
  });
});
