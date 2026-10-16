import { describe, expect, it, vi } from "vitest";
import { decideReplyForm, decideStampEmoji } from "../src/decisions";
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

describe("decideReplyForm", () => {
  it("returns the form chosen by Jev with the probabilities", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        answers: {
          q: {
            type: "choice",
            choice: "stamp",
            confidence: 0.83,
            probabilities: { stamp: 0.83, text: 0.17 },
          },
        },
      }),
    );

    const decision = await decideReplyForm(
      jevClient(fetchFn),
      context([message({ content: "それな" })]),
      BOT,
    );

    expect(decision).toEqual({
      form: "stamp",
      fallback: false,
      confidence: 0.83,
      probabilities: { stamp: 0.83, text: 0.17 },
    });
  });

  it("passes the recent conversation as the state", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(200, { answers: { q: { type: "choice", choice: "text" } } }),
    );

    await decideReplyForm(
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
    expect(body.questions.q.type).toBe("choice");
  });

  it("falls back to text when Jev cannot be reached", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

    const decision = await decideReplyForm(
      jevClient(fetchFn),
      context([message({ content: "きいて" })]),
      BOT,
    );

    expect(decision).toEqual({ form: "text", fallback: true });
  });
});

describe("decideStampEmoji", () => {
  it("returns the emoji chosen by Jev", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        answers: { q: { type: "choice", choice: "😂" } },
      }),
    );

    const decision = await decideStampEmoji(
      jevClient(fetchFn),
      context([message({ content: "その言い方ウケる" })]),
      BOT,
    );

    expect(decision).toEqual({ emoji: "😂", fallback: false });
  });

  it("falls back to the default emoji when Jev cannot be reached", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(503, {}));

    const decision = await decideStampEmoji(
      jevClient(fetchFn),
      context([message({ content: "それな" })]),
      BOT,
    );

    expect(decision).toEqual({ emoji: "👍", fallback: true });
  });
});
