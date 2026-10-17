import { describe, expect, it, vi } from "vitest";
import { jinaRead, jinaSearch } from "../src/jina";

function jsonFetch(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue(
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
}

function asFetch(fn: { mock: unknown }) {
  return fn as unknown as typeof fetch;
}

describe("jinaSearch", () => {
  it("sends the query with the API key and formats the results", async () => {
    const fetchFn = jsonFetch({
      data: [
        {
          title: "Durable Objects",
          url: "https://example.com/do",
          content: "本文1",
        },
        { description: "説明2" },
      ],
    });

    const text = await jinaSearch("durable objects とは", {
      apiKey: "jina-key",
      fetchFn: asFetch(fetchFn),
    });

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://s.jina.ai/?q=durable%20objects%20%E3%81%A8%E3%81%AF");
    expect(init.headers.Authorization).toBe("Bearer jina-key");
    expect(init.headers.Accept).toBe("application/json");
    expect(text).toContain("## Durable Objects");
    expect(text).toContain("https://example.com/do");
    expect(text).toContain("本文1");
    expect(text).toContain("## Result 2");
    expect(text).toContain("説明2");
  });

  it("honours the endpoint override with or without the trailing slash", async () => {
    for (const endpoint of ["https://jina.test/", "https://jina.test"]) {
      const fetchFn = jsonFetch({ data: [] });

      await jinaSearch("q", { apiKey: "k", endpoint, fetchFn: asFetch(fetchFn) });

      expect(fetchFn.mock.calls[0][0]).toBe("https://jina.test/?q=q");
    }
  });

  it("returns the raw body when the response is not a result list", async () => {
    const fetchFn = jsonFetch("ただのテキスト");

    const text = await jinaSearch("query", {
      apiKey: "k",
      fetchFn: asFetch(fetchFn),
    });

    expect(text).toBe("ただのテキスト");
  });

  it("throws with the status when the key is rejected", async () => {
    const fetchFn = jsonFetch({ code: 401 }, 401);

    await expect(
      jinaSearch("query", { apiKey: "bad", fetchFn: asFetch(fetchFn) }),
    ).rejects.toThrow(/jina 401/);
  });
});

describe("jinaRead", () => {
  it("fetches the page through the reader and truncates the body", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response("# ページ\n本文", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    );

    const text = await jinaRead("https://example.com/a", {
      apiKey: "k",
      fetchFn: asFetch(fetchFn),
      maxChars: 5,
    });

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://r.jina.ai/https://example.com/a");
    expect(init.headers.Accept).toBe("text/plain");
    expect(text).toBe("# ページ\n…(truncated)");
  });

  it("refuses anything that is not an http(s) URL", async () => {
    const fetchFn = vi.fn();

    await expect(
      jinaRead("file:///etc/passwd", { apiKey: "k", fetchFn: asFetch(fetchFn) }),
    ).rejects.toThrow(/http\(s\)/);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
