import { describe, expect, it } from "vitest";
import {
  buildPrompt,
  type ChannelContext,
  type LoggedMessage,
} from "../src/prompt";

const BOT = "1234567890";
const PERSONA = "あなたはAIメンバー（人格ブロック）";

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
      { botId: BOT, persona: PERSONA },
    );

    expect(prompt.map((m) => m.content)).toEqual([
      "ken: おはよう",
      "mika: おはよう〜",
      PERSONA,
    ]);
  });

  it("strips bot mentions and names the speaker", () => {
    const prompt = buildPrompt(
      context({ messages: [message({ content: `<@${BOT}> これ見て` })] }),
      { botId: BOT, persona: PERSONA },
    );

    expect(prompt[0]).toEqual({ role: "user", content: "ken: これ見て" });
  });

  it("falls back to a placeholder for a mention-only message", () => {
    const prompt = buildPrompt(
      context({ messages: [message({ content: `<@${BOT}>` })] }),
      { botId: BOT, persona: PERSONA },
    );

    expect(prompt[0].content).toBe("ken: (本文なし)");
  });

  it("renders bot replies as assistant messages", () => {
    const prompt = buildPrompt(
      context({
        messages: [message({ isBot: true, authorName: "bot", content: "やあ" })],
      }),
      { botId: BOT, persona: PERSONA },
    );

    expect(prompt[0]).toEqual({ role: "assistant", content: "やあ" });
  });

  it("puts the summary before the history", () => {
    const prompt = buildPrompt(
      context({
        summary: "先週は卒論の話をしていた。",
        messages: [message({ content: "つづき" })],
      }),
      { botId: BOT, persona: PERSONA },
    );

    expect(prompt.map((m) => m.role)).toEqual(["system", "user", "system"]);
    expect(prompt[0].content).toContain("先週は卒論の話をしていた。");
  });

  it("re-injects the persona at the end of every turn", () => {
    const first = buildPrompt(
      context({ messages: [message({ content: "やあ" })] }),
      { botId: BOT, persona: PERSONA },
    );
    const second = buildPrompt(
      context({
        summary: "要約",
        messages: [
          message({ id: "1", content: "やあ" }),
          message({ id: "2", isBot: true, content: "やあ、どうした？" }),
          message({ id: "3", content: "相談がある" }),
        ],
      }),
      { botId: BOT, persona: PERSONA },
    );

    expect(first.at(-1)).toEqual({ role: "system", content: PERSONA });
    expect(second.at(-1)).toEqual({ role: "system", content: PERSONA });
  });

  it("puts the speaker profile before the history", () => {
    const prompt = buildPrompt(
      context({
        summary: "先週は卒論の話をしていた。",
        messages: [message({ content: "つづき" })],
      }),
      {
        botId: BOT,
        persona: PERSONA,
        profile: {
          name: "ken",
          memories: ["大学院で生態学を研究している", "猫を飼っている"],
        },
      },
    );

    expect(prompt.map((m) => m.role)).toEqual([
      "system",
      "system",
      "user",
      "system",
    ]);
    expect(prompt[1].content).toContain("発言者（ken）");
    expect(prompt[1].content).toContain("- 猫を飼っている");
  });

  it("omits the profile when there are no memories", () => {
    const prompt = buildPrompt(
      context({ messages: [message({ content: "やあ" })] }),
      { botId: BOT, persona: PERSONA, profile: { name: "ken", memories: [] } },
    );

    expect(prompt).toEqual([
      { role: "user", content: "ken: やあ" },
      { role: "system", content: PERSONA },
    ]);
  });
});
