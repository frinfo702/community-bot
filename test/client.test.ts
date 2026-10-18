import { describe, expect, it, vi } from "vitest";
import { DiscordClient } from "../src/discord/client";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("DiscordClient", () => {
  it("retries a 429 after the advertised retry_after", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { retry_after: 0.01 }))
      .mockResolvedValueOnce(jsonResponse(200, {}));
    const sleep = vi.fn(async () => {});
    const client = new DiscordClient({
      token: "t",
      fetchFn: fetchFn as unknown as typeof fetch,
      sleep,
    });

    await client.postMessage("chan", "hello");

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(60);
    const [, init] = fetchFn.mock.calls[1];
    expect(JSON.parse(init.body).content).toBe("hello");
  });

  it("suppresses notifications when asked", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const client = new DiscordClient({
      token: "t",
      fetchFn: fetchFn as unknown as typeof fetch,
      sleep: async () => {},
    });

    await client.postMessage("chan", "見てみる", {
      replyTo: "msg-1",
      silent: true,
    });

    const [, init] = fetchFn.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.flags).toBe(1 << 12);
    expect(body.message_reference.message_id).toBe("msg-1");
  });

  it("cuts content at the 2000 character limit Discord allows", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const client = new DiscordClient({
      token: "t",
      fetchFn: fetchFn as unknown as typeof fetch,
      sleep: async () => {},
    });

    await client.postMessage("chan", "あ".repeat(2500));

    const [, init] = fetchFn.mock.calls[0];
    expect(JSON.parse(init.body).content).toHaveLength(2000);
  });

  it("attaches a reply reference when asked", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const client = new DiscordClient({
      token: "t",
      fetchFn: fetchFn as unknown as typeof fetch,
      sleep: async () => {},
    });

    await client.postMessage("chan", "hello", { replyTo: "msg-1" });

    const [, init] = fetchFn.mock.calls[0];
    expect(JSON.parse(init.body).message_reference).toEqual({
      message_id: "msg-1",
      fail_if_not_exists: false,
    });
    expect(init.headers.Authorization).toBe("Bot t");
  });

  it("posts without a reference when no reply is asked for", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const client = new DiscordClient({
      token: "t",
      fetchFn: fetchFn as unknown as typeof fetch,
      sleep: async () => {},
    });

    await client.postMessage("chan", "hello");

    const [, init] = fetchFn.mock.calls[0];
    expect(JSON.parse(init.body).message_reference).toBeUndefined();
  });

  it("graduates to an error when posting keeps failing", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(403, { message: "no" }));
    const client = new DiscordClient({
      token: "t",
      fetchFn: fetchFn as unknown as typeof fetch,
      sleep: async () => {},
    });

    await expect(client.postMessage("chan", "x")).rejects.toThrow(/403/);
  });

  it("adds a reaction with the emoji encoded in the path", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const client = new DiscordClient({
      token: "t",
      fetchFn: fetchFn as unknown as typeof fetch,
      sleep: async () => {},
    });

    await client.addReaction("chan", "msg-1", "👍");

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe(
      `https://discord.com/api/v10/channels/chan/messages/msg-1/reactions/${encodeURIComponent("👍")}/@me`,
    );
    expect(init.method).toBe("PUT");
  });

  it("graduates to an error when the reaction fails", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(403, { message: "no" }));
    const client = new DiscordClient({
      token: "t",
      fetchFn: fetchFn as unknown as typeof fetch,
      sleep: async () => {},
    });

    await expect(client.addReaction("chan", "msg-1", "👍")).rejects.toThrow(/403/);
  });

  it("lists the guild's usable custom emojis", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(200, [
        { id: "1", name: "kusa", available: true },
        { id: "2", name: "gone", available: false },
      ]),
    );
    const client = new DiscordClient({
      token: "t",
      fetchFn: fetchFn as unknown as typeof fetch,
      sleep: async () => {},
    });

    await expect(client.listGuildEmojis("g1")).resolves.toEqual([
      { id: "1", name: "kusa" },
    ]);

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://discord.com/api/v10/guilds/g1/emojis");
    expect(init.method).toBe("GET");
  });

  it("graduates to an error when the emoji list cannot be read", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(403, { message: "no" }));
    const client = new DiscordClient({
      token: "t",
      fetchFn: fetchFn as unknown as typeof fetch,
      sleep: async () => {},
    });

    await expect(client.listGuildEmojis("g1")).rejects.toThrow(/403/);
  });

  it("opens a DM channel and returns its id", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { id: "dm-1" }));
    const client = new DiscordClient({
      token: "t",
      fetchFn: fetchFn as unknown as typeof fetch,
      sleep: async () => {},
    });

    await expect(client.openDM("u1")).resolves.toBe("dm-1");

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://discord.com/api/v10/users/@me/channels");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body).recipient_id).toBe("u1");
  });

  it("graduates to an error when the DM channel cannot be opened", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(403, { message: "no" }));
    const client = new DiscordClient({
      token: "t",
      fetchFn: fetchFn as unknown as typeof fetch,
      sleep: async () => {},
    });

    await expect(client.openDM("u1")).rejects.toThrow(/403/);
  });

  it("registers the global commands with PUT", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, []));
    const client = new DiscordClient({
      token: "t",
      fetchFn: fetchFn as unknown as typeof fetch,
      sleep: async () => {},
    });

    await client.putGlobalCommands("app-1", [{ name: "memory" }]);

    const [url, init] = fetchFn.mock.calls[1];
    expect(url).toBe("https://discord.com/api/v10/applications/app-1/commands");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual([{ name: "memory" }]);
  });

  it("keeps the Activity entry point command when re-registering", async () => {
    const entryPoint = { id: "e1", name: "launch", type: 4, handler: 2 };
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, [{ id: "c1", name: "cafe", type: 1 }, entryPoint]),
      )
      .mockResolvedValueOnce(jsonResponse(200, []));
    const client = new DiscordClient({
      token: "t",
      fetchFn: fetchFn as unknown as typeof fetch,
      sleep: async () => {},
    });

    await client.putGlobalCommands("app-1", [{ name: "cafe" }]);

    expect(fetchFn.mock.calls[0][1].method).toBe("GET");
    expect(JSON.parse(fetchFn.mock.calls[1][1].body)).toEqual([
      { name: "cafe" },
      entryPoint,
    ]);
  });

  it("graduates to an error when registration fails", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(403, { message: "no" }));
    const client = new DiscordClient({
      token: "t",
      fetchFn: fetchFn as unknown as typeof fetch,
      sleep: async () => {},
    });

    await expect(
      client.putGlobalCommands("app-1", [{ name: "memory" }]),
    ).rejects.toThrow(/403/);
  });

  it("posts an image as multipart without a JSON content type", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const client = new DiscordClient({
      token: "t",
      fetchFn: fetchFn as unknown as typeof fetch,
      sleep: async () => {},
    });

    await client.postImage(
      "chan",
      { data: new Uint8Array([1, 2]), contentType: "image/jpeg" },
      { content: "どうぞ", replyTo: "msg-1" },
    );

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://discord.com/api/v10/channels/chan/messages");
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.get("payload_json")).toBe(
      JSON.stringify({
        content: "どうぞ",
        message_reference: { message_id: "msg-1", fail_if_not_exists: false },
      }),
    );
    const file = form.get("files[0]") as File;
    expect(file.name).toBe("image.jpg");
    expect(file.type).toBe("image/jpeg");
    expect(init.headers["Content-Type"]).toBeUndefined();
  });
});
