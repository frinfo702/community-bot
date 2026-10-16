import { describe, expect, it, vi } from "vitest";
import { sendMemoryList } from "../src/commands";

function fakeDiscord(openDM: () => Promise<string>) {
  return {
    openDM: vi.fn(openDM),
    postMessage: vi.fn(
      async (
        _channelId: string,
        _content: string,
        _options?: { replyTo?: string },
      ) => {},
    ),
  };
}

const message = {
  id: "msg-1",
  channel_id: "chan-1",
  guild_id: "guild-1",
  author: { id: "u1" },
};

describe("sendMemoryList", () => {
  it("sends the list to the DM and only a notice to the channel", async () => {
    const discord = fakeDiscord(async () => "dm-1");

    await sendMemoryList(discord, message, "記憶の一覧");

    expect(discord.openDM).toHaveBeenCalledWith("u1");
    expect(discord.postMessage).toHaveBeenNthCalledWith(1, "dm-1", "記憶の一覧");
    expect(discord.postMessage).toHaveBeenNthCalledWith(
      2,
      "chan-1",
      "記憶はDMに送りました。",
      { replyTo: "msg-1" },
    );
  });

  it("does not post a notice back into a DM", async () => {
    const discord = fakeDiscord(async () => "dm-1");

    await sendMemoryList(
      discord,
      { ...message, guild_id: undefined },
      "記憶の一覧",
    );

    expect(discord.postMessage).toHaveBeenCalledTimes(1);
    expect(discord.postMessage).toHaveBeenCalledWith("dm-1", "記憶の一覧");
  });

  it("keeps the memories out of the channel when the DM cannot be opened", async () => {
    const discord = fakeDiscord(async () => {
      throw new Error("403");
    });

    await sendMemoryList(discord, message, "記憶の一覧");

    expect(discord.postMessage).toHaveBeenCalledTimes(1);
    const [channelId, content] = discord.postMessage.mock.calls[0];
    expect(channelId).toBe("chan-1");
    expect(content).not.toContain("記憶の一覧");
  });
});
