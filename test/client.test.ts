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

  it("graduates to an error when posting keeps failing", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(403, { message: "no" }));
    const client = new DiscordClient({
      token: "t",
      fetchFn: fetchFn as unknown as typeof fetch,
      sleep: async () => {},
    });

    await expect(client.postMessage("chan", "x")).rejects.toThrow(/403/);
  });
});
