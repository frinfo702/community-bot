import { describe, expect, it } from "vitest";
import {
  imageUrls,
  isBotMentioned,
  quotedLine,
  stripBotMentions,
  type DiscordMessage,
} from "../src/discord/mention";

const BOT = "1234567890";

function message(partial: Partial<DiscordMessage>): DiscordMessage {
  return {
    id: "1",
    channel_id: "c1",
    content: "",
    author: { id: "u1" },
    ...partial,
  };
}

describe("isBotMentioned", () => {
  it("detects the bot in the mentions array", () => {
    const msg = message({ content: `<@${BOT}> やあ`, mentions: [{ id: BOT }] });
    expect(isBotMentioned(msg, BOT)).toBe(true);
  });

  it("ignores mentions of other members", () => {
    const msg = message({ content: "<@999> やあ", mentions: [{ id: "999" }] });
    expect(isBotMentioned(msg, BOT)).toBe(false);
  });

  it("returns false without mentions", () => {
    expect(isBotMentioned(message({ content: `<@${BOT}>` }), BOT)).toBe(false);
  });
});

describe("stripBotMentions", () => {
  it("removes plain and nickname mentions", () => {
    expect(stripBotMentions(`<@${BOT}> <@!${BOT}> これ見て`, BOT)).toBe("これ見て");
  });

  it("keeps mentions of other members", () => {
    expect(stripBotMentions(`<@${BOT}> <@999> これ見て`, BOT)).toBe("<@999> これ見て");
  });

  it("returns an empty string for a mention-only message", () => {
    expect(stripBotMentions(`<@${BOT}>`, BOT)).toBe("");
  });
});

describe("quotedLine", () => {
  it("renders the message a reply quotes as one line", () => {
    const msg = message({
      content: "八千代、これ取ったよー",
      referenced_message: {
        id: "9",
        content: "西園寺記念奨学金をとれた",
        author: { id: "u1", global_name: "Jugram Haschwalth" },
      },
    });

    expect(quotedLine(msg, BOT)).toBe("Jugram Haschwalth: 西園寺記念奨学金をとれた");
  });

  it("names the bot's own messages bot", () => {
    const msg = message({
      referenced_message: { id: "9", content: "やあ", author: { id: BOT } },
    });

    expect(quotedLine(msg, BOT)).toBe("bot: やあ");
  });

  it("returns undefined without a reference or without text", () => {
    expect(quotedLine(message({ content: "やあ" }), BOT)).toBeUndefined();
    expect(
      quotedLine(
        message({
          referenced_message: { id: "9", content: `<@${BOT}>`, author: { id: "u1" } },
        }),
        BOT,
      ),
    ).toBeUndefined();
  });

  it("caps a long quoted body", () => {
    const msg = message({
      referenced_message: { id: "9", content: "あ".repeat(300), author: { id: "u1" } },
    });

    expect(quotedLine(msg, BOT)).toBe(`u1: ${"あ".repeat(200)}…`);
  });
});

describe("imageUrls", () => {
  it("keeps image attachments in order and drops other files", () => {
    const msg = message({
      attachments: [
        { url: "https://cdn.test/a.png", content_type: "image/png" },
        { url: "https://cdn.test/paper.pdf", content_type: "application/pdf" },
        { url: "https://cdn.test/b.jpg", content_type: "image/jpeg" },
      ],
    });

    expect(imageUrls(msg)).toEqual([
      "https://cdn.test/a.png",
      "https://cdn.test/b.jpg",
    ]);
  });

  it("drops attachments without a content type", () => {
    const msg = message({ attachments: [{ url: "https://cdn.test/x" }] });
    expect(imageUrls(msg)).toEqual([]);
  });

  it("returns an empty list for a message without attachments", () => {
    expect(imageUrls(message({ content: "やあ" }))).toEqual([]);
  });
});
