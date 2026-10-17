import { describe, expect, it } from "vitest";
import {
  buildPrompt,
  buildTaskPrompt,
  type ChannelContext,
  type LoggedMessage,
} from "../src/prompt";

const BOT = "1234567890";
const PERSONA = "あなたはAIメンバー（人格ブロック）";
const SELF = "自分のできること（botch-doc ブロック）";

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

    expect(prompt[0].content).toBe("ken: (no text)");
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
    expect(prompt[1].content).toContain("What is known about the speaker (ken)");
    expect(prompt[1].content).toContain("- 猫を飼っている");
  });

  it("puts the self knowledge right before the persona", () => {
    const prompt = buildPrompt(
      context({ messages: [message({ content: "できること教えて" })] }),
      { botId: BOT, persona: PERSONA, self: SELF },
    );

    expect(prompt.map((m) => m.role)).toEqual(["user", "system", "system"]);
    expect(prompt.at(-2)).toEqual({ role: "system", content: SELF });
    expect(prompt.at(-1)).toEqual({ role: "system", content: PERSONA });
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

  it("passes the images of the request message as content parts", () => {
    const prompt = buildPrompt(
      context({
        messages: [message({ content: `<@${BOT}> これ何?` })],
      }),
      {
        botId: BOT,
        persona: PERSONA,
        images: { messageId: "1", urls: ["https://cdn.test/a.png"] },
      },
    );

    expect(prompt[0]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "ken: これ何?" },
        { type: "image_url", image_url: { url: "https://cdn.test/a.png" } },
      ],
    });
  });

  it("keeps the placeholder for an image-only request", () => {
    const prompt = buildPrompt(
      context({ messages: [message({ content: `<@${BOT}>` })] }),
      {
        botId: BOT,
        persona: PERSONA,
        images: { messageId: "1", urls: ["https://cdn.test/a.png"] },
      },
    );

    expect(prompt[0].content).toEqual([
      { type: "text", text: "ken: (no text)" },
      { type: "image_url", image_url: { url: "https://cdn.test/a.png" } },
    ]);
  });

  it("attaches the images to the request message, not to the newest line", () => {
    const prompt = buildPrompt(
      context({
        messages: [
          message({ id: "1", content: `<@${BOT}> これ何?` }),
          message({ id: "2", authorName: "mika", content: "どうしたの" }),
        ],
      }),
      {
        botId: BOT,
        persona: PERSONA,
        images: { messageId: "1", urls: ["https://cdn.test/a.png"] },
      },
    );

    expect(prompt[0].content).toEqual([
      { type: "text", text: "ken: これ何?" },
      { type: "image_url", image_url: { url: "https://cdn.test/a.png" } },
    ]);
    expect(prompt[1].content).toBe("mika: どうしたの");
  });
});

describe("buildTaskPrompt", () => {
  it("passes the recent conversation and ends with the requester line", () => {
    const request = buildTaskPrompt(
      context({
        messages: [
          message({ content: "この論文どう思う" }),
          message({ id: "2", authorName: "bot", isBot: true, content: "面白そう" }),
          message({ id: "3", authorName: "aoi", content: "<@1234567890> 参考文献を調べて" }),
        ],
      }),
      { botId: BOT, authorName: "aoi" },
    );

    expect(request).toContain("ken: この論文どう思う");
    expect(request).toContain("bot: 面白そう");
    // The mention is stripped from the request itself
    expect(request).toContain("aoi: 参考文献を調べて");
    expect(request).not.toContain("<@1234567890>");
    expect(request.endsWith("The last message (from aoi) is the request.")).toBe(true);
  });

  it("keeps only the last 10 messages", () => {
    const messages = Array.from({ length: 12 }, (_, i) =>
      message({ id: `${i}`, content: `token-${i}-end` }),
    );

    const request = buildTaskPrompt(context({ messages }), {
      botId: BOT,
      authorName: "ken",
    });

    expect(request).not.toContain("token-0-end");
    expect(request).not.toContain("token-1-end");
    expect(request).toContain("token-2-end");
    expect(request).toContain("token-11-end");
  });
});
