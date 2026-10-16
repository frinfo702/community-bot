import { describe, expect, it, vi } from "vitest";
import { executeTask, extractUrl } from "../src/task";

describe("extractUrl", () => {
  it("returns the first URL in the message", () => {
    expect(extractUrl("<@123> https://example.com/a をまとめて")).toBe(
      "https://example.com/a",
    );
  });

  it("drops the punctuation that ends the sentence", () => {
    expect(extractUrl("see https://example.com/a。")).toBe("https://example.com/a");
    expect(extractUrl("see (https://example.com/a).")).toBe("https://example.com/a");
  });

  it("returns null when the message has no URL", () => {
    expect(extractUrl("これどう思う？")).toBeNull();
  });

  it("refuses local addresses", () => {
    expect(extractUrl("http://localhost:8787/status")).toBeNull();
    expect(extractUrl("http://127.0.0.1/")).toBeNull();
    expect(extractUrl("http://169.254.169.254/latest/meta-data")).toBeNull();
    expect(extractUrl("http://10.0.0.1/")).toBeNull();
    expect(extractUrl("http://192.168.1.1/")).toBeNull();
    expect(extractUrl("http://172.20.1.1/")).toBeNull();
    expect(extractUrl("http://[fe80::1]/")).toBeNull();
    expect(extractUrl("http://[fd00::1]/")).toBeNull();
  });
});

describe("executeTask", () => {
  it("fetches the URL in the sandbox and summarizes the page", async () => {
    const fetchText = vi.fn().mockResolvedValue("ページ本文");
    const summarize = vi.fn().mockResolvedValue({
      summary: "要約",
      usage: { total_tokens: 42 },
    });

    const task = await executeTask("https://example.com/a を要約して", {
      fetchText,
      summarize,
    });

    expect(fetchText).toHaveBeenCalledWith("https://example.com/a");
    expect(summarize).toHaveBeenCalledWith("https://example.com/a", "ページ本文");
    expect(task).toMatchObject({
      url: "https://example.com/a",
      summary: "要約",
      usage: { total_tokens: 42 },
    });
    expect(task?.sandboxMs).toBeGreaterThanOrEqual(0);
  });

  it("returns null when the message has no URL", async () => {
    const fetchText = vi.fn();
    const summarize = vi.fn();

    expect(await executeTask("要約して", { fetchText, summarize })).toBeNull();
    expect(fetchText).not.toHaveBeenCalled();
    expect(summarize).not.toHaveBeenCalled();
  });

  it("returns null and logs when the sandbox fetch fails (text reply fallback)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchText = vi.fn().mockRejectedValue(new Error("curl exit 6"));
    const summarize = vi.fn();

    expect(
      await executeTask("https://example.com/a", { fetchText, summarize }),
    ).toBeNull();
    expect(summarize).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      "task execution failed",
      "https://example.com/a",
      expect.any(Error),
    );
    error.mockRestore();
  });

  it("returns null when the summary fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(
      await executeTask("https://example.com/a", {
        fetchText: vi.fn().mockResolvedValue("本文"),
        summarize: vi.fn().mockRejectedValue(new Error("ai gateway 503")),
      }),
    ).toBeNull();
    error.mockRestore();
  });
});
