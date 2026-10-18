import { afterEach, describe, expect, it, vi } from "vitest";
import { ackText, FALLBACK_ACK } from "../src/ack";
import type { ChatMessage } from "../src/llm";

const input = {
  context: {
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
  },
  botId: "bot-1",
  persona: "あなたは「八千代」",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ackText", () => {
  it("uses the model's line when it is short", async () => {
    const generate = vi.fn(async () => "ほう、少し待て");

    await expect(ackText(generate, input)).resolves.toBe("ほう、少し待て");
  });

  it("keeps only the first line", async () => {
    const generate = vi.fn(async () => "少し待て\nついでに説明も書いてしまう");

    await expect(ackText(generate, input)).resolves.toBe("少し待て");
  });

  it("falls back when the line is too long for an acknowledgment", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const generate = vi.fn(async () => "あ".repeat(41));

    await expect(ackText(generate, input)).resolves.toBe(FALLBACK_ACK);
  });

  it("falls back when the model cannot be reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const generate = vi.fn(async () => {
      throw new Error("gateway down");
    });

    await expect(ackText(generate, input)).resolves.toBe(FALLBACK_ACK);
  });

  it("reads the conversation tail, the instruction and the persona", async () => {
    const calls: ChatMessage[][] = [];
    const generate = vi.fn(async (messages: ChatMessage[]) => {
      calls.push(messages);
      return "はい";
    });

    await ackText(generate, input);

    const sent = calls[0];
    expect(sent[0].role).toBe("user");
    expect(String(sent[0].content)).toContain("これ調べて");
    expect(sent.some((message) => String(message.content).includes("one short line"))).toBe(true);
    expect(sent.at(-1)?.content).toBe(input.persona);
  });
});
