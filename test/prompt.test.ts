import { describe, expect, it } from "vitest";
import {
  buildPrompt,
  buildTaskPrompt,
  timePrefix,
  type ChannelContext,
  type LoggedMessage,
} from "../src/prompt";

const BOT = "1234567890";
const PERSONA = "あなたはAIメンバー（人格ブロック）";
const SELF = "自分のできること（botch-doc ブロック）";
// 2026-10-18 12:15 JST, fixed so relative day labels are deterministic
const NOW = Date.UTC(2026, 9, 18, 3, 15);

/** JST wall clock as a timestamp: jst(2026, 10, 18, 12, 15) */
function jst(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): number {
  return Date.UTC(year, month - 1, day, hour - 9, minute);
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
      { botId: BOT, now: NOW, persona: PERSONA },
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
      { botId: BOT, now: NOW, persona: PERSONA },
    );

    expect(prompt[0]).toEqual({ role: "user", content: "ken: これ見て" });
  });

  it("falls back to a placeholder for a mention-only message", () => {
    const prompt = buildPrompt(
      context({ messages: [message({ content: `<@${BOT}>` })] }),
      { botId: BOT, now: NOW, persona: PERSONA },
    );

    expect(prompt[0].content).toBe("ken: (no text)");
  });

  it("renders bot replies as assistant messages", () => {
    const prompt = buildPrompt(
      context({
        messages: [message({ isBot: true, authorName: "bot", content: "やあ" })],
      }),
      { botId: BOT, now: NOW, persona: PERSONA },
    );

    expect(prompt[0]).toEqual({ role: "assistant", content: "やあ" });
  });

  it("puts the summary before the history", () => {
    const prompt = buildPrompt(
      context({
        summary: "先週は卒論の話をしていた。",
        messages: [message({ content: "つづき" })],
      }),
      { botId: BOT, now: NOW, persona: PERSONA },
    );

    expect(prompt.map((m) => m.role)).toEqual(["system", "user", "system"]);
    expect(prompt[0].content).toContain("先週は卒論の話をしていた。");
  });

  it("re-injects the persona at the end of every turn", () => {
    const first = buildPrompt(
      context({ messages: [message({ content: "やあ" })] }),
      { botId: BOT, now: NOW, persona: PERSONA },
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
      { botId: BOT, now: NOW, persona: PERSONA },
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
        now: NOW,
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
      { botId: BOT, now: NOW, persona: PERSONA, self: SELF },
    );

    expect(prompt.map((m) => m.role)).toEqual(["user", "system", "system"]);
    expect(prompt.at(-2)).toEqual({ role: "system", content: SELF });
    expect(prompt.at(-1)).toEqual({ role: "system", content: PERSONA });
  });

  it("omits the profile when there are no memories", () => {
    const prompt = buildPrompt(
      context({ messages: [message({ content: "やあ" })] }),
      {
        botId: BOT,
        now: NOW,
        persona: PERSONA,
        profile: { name: "ken", memories: [] },
      },
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
        now: NOW,
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
        now: NOW,
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
        now: NOW,
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

  it("shows what a message quotes so a later これ has a referent", () => {
    const prompt = buildPrompt(
      context({
        messages: [
          message({
            id: "1",
            content: "これ取ったよー",
            quoted: "ken: 西園寺記念奨学金をとれた",
          }),
          message({ id: "2", content: `<@${BOT}>`, authorName: "ken" }),
        ],
      }),
      { botId: BOT, now: NOW, persona: PERSONA },
    );

    expect(prompt[0].content).toBe(
      "ken: これ取ったよー (replying to ken: 西園寺記念奨学金をとれた)",
    );
    expect(prompt[1].content).toBe("ken: (no text)");
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
      { botId: BOT, now: NOW, authorName: "aoi" },
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
      now: NOW,
      authorName: "ken",
    });

    expect(request).not.toContain("token-0-end");
    expect(request).not.toContain("token-1-end");
    expect(request).toContain("token-2-end");
    expect(request).toContain("token-11-end");
  });
});

describe("timePrefix", () => {
  it("uses JST calendar days, not elapsed hours", () => {
    // 2 hours before midnight is still yesterday
    expect(timePrefix(jst(2026, 10, 17, 23, 0), jst(2026, 10, 18, 1, 0))).toBe(
      "[昨日 23:00] ",
    );

    // 46 hours back is still yesterday
    expect(timePrefix(jst(2026, 10, 17, 1, 0), jst(2026, 10, 18, 23, 0))).toBe(
      "[昨日 01:00] ",
    );
  });

  it("labels today, 一昨日, and older messages", () => {
    const now = jst(2026, 10, 18, 23, 0);
    expect(timePrefix(jst(2026, 10, 18, 13, 33), now)).toBe("[今日 13:33] ");
    expect(timePrefix(jst(2026, 10, 16, 23, 59), now)).toBe("[一昨日 23:59] ");
    expect(timePrefix(jst(2026, 10, 15, 23, 59), now)).toBe("[10/15 23:59] ");
  });

  it("adds the year only when it differs from now", () => {
    expect(timePrefix(jst(2025, 12, 28, 23, 59), jst(2026, 1, 1, 12, 0))).toBe(
      "[2025/12/28 23:59] ",
    );
  });

  it("returns nothing for a message with no clock", () => {
    expect(timePrefix(0, NOW)).toBe("");
  });
});

describe("labelled prompts", () => {
  it("labels user lines in the reply prompt but leaves assistant lines raw", () => {
    const prompt = buildPrompt(
      context({
        messages: [
          message({
            id: "1",
            content: "もう夜だけど起きてる",
            createdAt: jst(2026, 10, 17, 23, 41),
          }),
          message({
            id: "2",
            isBot: true,
            authorName: "bot",
            content: "今夜はもう寝ておけ。",
            createdAt: jst(2026, 10, 17, 23, 42),
          }),
          message({
            id: "3",
            content: "おはよう",
            createdAt: jst(2026, 10, 18, 12, 15),
          }),
        ],
      }),
      { botId: BOT, now: jst(2026, 10, 18, 12, 15), persona: PERSONA },
    );

    expect(prompt[0].content).toBe("[昨日 23:41] ken: もう夜だけど起きてる");
    expect(prompt[1]).toEqual({
      role: "assistant",
      content: "今夜はもう寝ておけ。",
    });
    expect(prompt[2].content).toBe("[今日 12:15] ken: おはよう");
  });

  it("labels the task prompt, including bot lines", () => {
    const request = buildTaskPrompt(
      context({
        messages: [
          message({
            id: "1",
            content: "これ調べて",
            createdAt: jst(2026, 10, 17, 23, 41),
          }),
          message({
            id: "2",
            isBot: true,
            authorName: "bot",
            content: "明日まで待て",
            createdAt: jst(2026, 10, 17, 23, 42),
          }),
        ],
      }),
      { botId: BOT, now: jst(2026, 10, 18, 12, 15), authorName: "ken" },
    );

    expect(request).toContain("[昨日 23:41] ken: これ調べて");
    expect(request).toContain("[昨日 23:42] bot: 明日まで待て");
  });
});
