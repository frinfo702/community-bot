import { describe, expect, it } from "vitest";
import {
  imageUrls,
  isBotMentioned,
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
