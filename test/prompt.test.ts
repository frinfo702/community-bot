import { describe, expect, it } from "vitest";
import {
  buildPrompt,
  type ChannelContext,
  type LoggedMessage,
} from "../src/prompt";

const BOT = "1234567890";

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

function context(partial: Partial<ChannelContext>): ChannelContext {
  return { summary: null, messages: [], ...partial };
}

describe("buildPrompt", () => {
  it("keeps the history in oldest to newest order", () => {
    const prompt = buildPrompt(
      context({
        messages: [
          message({ id: "1", content: "おはよう" }),
          message({ id: "2", authorName: "mika", content: "おはよう〜" }),
        ],
      }),
      { botId: BOT },
    );

    expect(prompt.map((m) => m.content)).toEqual([
      "ken: おはよう",
      "mika: おはよう〜",
    ]);
  });

  it("strips bot mentions and names the speaker", () => {
    const prompt = buildPrompt(
      context({ messages: [message({ content: `<@${BOT}> これ見て` })] }),
      { botId: BOT },
    );

    expect(prompt).toEqual([{ role: "user", content: "ken: これ見て" }]);
  });

  it("falls back to a placeholder for a mention-only message", () => {
    const prompt = buildPrompt(
      context({ messages: [message({ content: `<@${BOT}>` })] }),
      { botId: BOT },
    );

    expect(prompt[0].content).toBe("ken: (本文なし)");
  });

  it("renders bot replies as assistant messages", () => {
    const prompt = buildPrompt(
      context({
        messages: [message({ isBot: true, authorName: "bot", content: "やあ" })],
      }),
      { botId: BOT },
    );

    expect(prompt).toEqual([{ role: "assistant", content: "やあ" }]);
  });

  it("puts the system prompt and the summary before the history", () => {
    const prompt = buildPrompt(
      context({
        summary: "先週は卒論の話をしていた。",
        messages: [message({ content: "つづき" })],
      }),
      { botId: BOT, system: "あなたはAIメンバー" },
    );

    expect(prompt.map((m) => m.role)).toEqual(["system", "system", "user"]);
    expect(prompt[1].content).toContain("先週は卒論の話をしていた。");
  });
});
