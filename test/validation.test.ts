import { describe, expect, it, vi } from "vitest";
import { JevClient } from "../src/jev";
import {
  repeatGate,
  reviewReply,
  sentences,
  type ReplyGate,
  type ReviewDeps,
} from "../src/validation";

function jevClient(fetchFn: unknown): JevClient {
  return new JevClient({
    apiKey: "k",
    model: "jev-latest",
    fetchFn: fetchFn as typeof fetch,
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function booleanResponse(probability: number): Response {
  return jsonResponse(200, {
    answers: { q: { type: "noul", noul: probability } },
  });
}

/** Deps with spies; a test overrides only what it asserts on. */
function deps(overrides: Partial<ReviewDeps>): ReviewDeps {
  return {
    gates: [],
    retry: vi.fn(),
    onReject: vi.fn(),
    log: vi.fn(),
    ...overrides,
  };
}

/** A gate that fails for the first `times` calls, pointing at the given sentences. */
function failingGate(cut: string[], times = 1): ReplyGate {
  let calls = 0;
  return {
    name: "test",
    check: async () =>
      ++calls <= times
        ? { pass: false, cut, reason: "test failure" }
        : { pass: true },
  };
}

const passing: ReplyGate = { name: "ok", check: async () => ({ pass: true }) };

describe("sentences", () => {
  it("splits on Japanese end marks and line breaks, and drops blanks", () => {
    expect(sentences("うむ。それはよかった。\n\nあとでな。")).toEqual([
      "うむ。",
      "それはよかった。",
      "あとでな。",
    ]);
  });

  it("keeps a reply without end marks as one sentence", () => {
    expect(sentences("うむ")).toEqual(["うむ"]);
  });
});

describe("reviewReply", () => {
  it("returns the reply unchanged and asks for no retry when every gate passes", async () => {
    const run = deps({ gates: [passing] });

    expect(await reviewReply(run, { text: "うむ。", preceding: [] })).toBe(
      "うむ。",
    );
    expect(run.retry).not.toHaveBeenCalled();
    expect(run.onReject).not.toHaveBeenCalled();
  });

  it("cuts the flagged sentences, asks again, and reports the withheld text", async () => {
    const retry = vi.fn().mockResolvedValue("それはよかったのう。");

    const text = await reviewReply(
      deps({ gates: [failingGate(["うむ。"])], retry }),
      { text: "うむ。それはよかったのう。", preceding: ["ken: 受かった"] },
    );

    // Only the flagged sentence is cut before the retry sees the reply
    expect(retry).toHaveBeenCalledWith({
      text: "それはよかったのう。",
      withheld: "うむ。それはよかったのう。",
      cut: ["うむ。"],
    });
    expect(text).toBe("それはよかったのう。");
  });

  it("reports the gate, reason and text of every withheld generation", async () => {
    const onReject = vi.fn();

    await reviewReply(
      deps({
        gates: [failingGate(["うむ。"])],
        retry: vi.fn().mockResolvedValue("それはよかったのう。"),
        onReject,
      }),
      { text: "うむ。それはよかったのう。", preceding: [] },
    );

    expect(onReject).toHaveBeenCalledWith({
      gate: "test",
      reason: "test failure",
      cut: ["うむ。"],
      text: "うむ。それはよかったのう。",
    });
  });

  it("keeps the text when the gate could not point at a sentence", async () => {
    const run = deps({ gates: [failingGate([], 2)] });

    expect(await reviewReply(run, { text: "うむ。", preceding: [] })).toBe(
      "うむ。",
    );
    expect(run.retry).toHaveBeenCalledWith({
      text: "うむ。",
      withheld: "うむ。",
      cut: [],
    });
  });

  it("stops at the attempt budget and returns the cut text", async () => {
    const retry = vi.fn().mockResolvedValue("また言うたのう。");

    const text = await reviewReply(
      deps({ gates: [failingGate(["また言うたのう。"], 2)], retry }),
      { text: "また言うたのう。", preceding: [] },
    );

    expect(retry).toHaveBeenCalledTimes(1);
    expect(text).toBe("");
  });

  it("leaves the cut text in place when the retry fails", async () => {
    const log = vi.fn();

    const text = await reviewReply(
      deps({
        gates: [failingGate(["うむ。"])],
        retry: vi.fn().mockRejectedValue(new Error("ai gateway 500")),
        log,
      }),
      { text: "うむ。それはよかったのう。", preceding: [] },
    );

    expect(text).toBe("それはよかったのう。");
    expect(log.mock.calls[1][0]).toContain("retry failed");
  });
});

describe("repeatGate", () => {
  const preceding = ["bot: それより昼餉は食うたのか。勉強はそのあとじゃぞ。"];

  it("passes a reply Jev does not read as a repeat", async () => {
    const fetchFn = vi.fn().mockResolvedValue(booleanResponse(0.2));

    const verdict = await repeatGate(jevClient(fetchFn)).check({
      text: "うむ。",
      preceding,
    });

    expect(verdict).toEqual({ pass: true });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("cuts only the sentences that repeat the preceding turn", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(booleanResponse(0.9))
      .mockResolvedValueOnce(booleanResponse(0.1))
      .mockResolvedValueOnce(booleanResponse(0.8));

    const verdict = await repeatGate(jevClient(fetchFn)).check({
      text: "昨日のことは並べられぬのじゃ。それより昼餉は食うたのか。",
      preceding,
    });

    expect(verdict).toEqual({
      pass: false,
      reason: "repeats the preceding turn (p=0.90)",
      cut: ["それより昼餉は食うたのか。"],
    });
    // The preceding turn is part of the state, so Jev judges against it
    const body = JSON.parse(fetchFn.mock.calls[0][1].body as string);
    expect(body.state).toContain("Preceding turn:");
    expect(body.state).toContain("勉強はそのあとじゃぞ。");
  });

  it("passes the reply when Jev cannot be asked", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(503, {}));

    expect(
      await repeatGate(jevClient(fetchFn)).check({ text: "うむ。", preceding }),
    ).toEqual({ pass: true });
  });
});

describe("reviewReply with the repeat gate", () => {
  it("cuts what the preceding turn said and posts what the retry writes", async () => {
    const fetchFn = vi
      .fn()
      // First generation: the whole reply repeats, so the closing line is cut
      .mockResolvedValueOnce(booleanResponse(0.9))
      .mockResolvedValueOnce(booleanResponse(0.1))
      .mockResolvedValueOnce(booleanResponse(0.9))
      // Second generation: nothing repeats
      .mockResolvedValueOnce(booleanResponse(0.1));
    const retry = vi.fn().mockResolvedValue("昨日は奨学金の話をしたぞ。");

    const text = await reviewReply(
      deps({ gates: [repeatGate(jevClient(fetchFn))], retry }),
      {
        text: "昨日のことは並べられぬのじゃ。それより昼餉は食うたのか。",
        preceding: ["bot: それより昼餉は食うたのか。"],
      },
    );

    expect(retry.mock.calls[0][0].text).toBe("昨日のことは並べられぬのじゃ。");
    expect(text).toBe("昨日は奨学金の話をしたぞ。");
  });
});
