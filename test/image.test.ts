import { describe, expect, it, vi } from "vitest";
import { generateImage } from "../src/image";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("generateImage", () => {
  it("decodes a base64 image from the generations endpoint", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        data: [{ b64_json: btoa("png-bytes") }],
        usage: { cost: 0.04 },
      }),
    );

    const image = await generateImage({
      apiKey: "k",
      model: "openai/gpt-image-1",
      prompt: "猫の絵",
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(new TextDecoder().decode(image.data)).toBe("png-bytes");
    expect(image.contentType).toBe("image/png");
    expect(image.usage).toEqual({ cost: 0.04 });

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://ai-gateway.vercel.sh/v1/images/generations");
    expect(JSON.parse(init.body)).toEqual({
      model: "openai/gpt-image-1",
      prompt: "猫の絵",
      n: 1,
    });
    expect(init.headers.Authorization).toBe("Bearer k");
  });

  it("downloads the image when the API answers with a URL", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, { data: [{ url: "https://img.test/a.jpg" }] }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "content-type": "image/jpeg" },
        }),
      );

    const image = await generateImage({
      apiKey: "k",
      model: "m",
      prompt: "p",
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    expect(Array.from(image.data)).toEqual([1, 2, 3]);
    expect(image.contentType).toBe("image/jpeg");
  });

  it("throws when the gateway rejects the request", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse(402, { error: "no credits" }));

    await expect(
      generateImage({
        apiKey: "k",
        model: "m",
        prompt: "p",
        fetchFn: fetchFn as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/402/);
  });

  it("throws when no image comes back", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { data: [] }));

    await expect(
      generateImage({
        apiKey: "k",
        model: "m",
        prompt: "p",
        fetchFn: fetchFn as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/no image/);
  });
});
