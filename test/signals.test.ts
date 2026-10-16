import { describe, expect, it, vi } from "vitest";
import { JevClient } from "../src/jev";
import {
  CORRECTION_QUESTION,
  CORRECTION_THRESHOLD,
  decideCorrection,
  reactionTarget,
} from "../src/signals";

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

describe("reactionTarget", () => {
  it("extracts the message, user and emoji from a reaction event", () => {
    expect(
      reactionTarget({
        user_id: "u1",
        message_id: "m1",
        channel_id: "c1",
        emoji: { id: null, name: "👍" },
      }),
    ).toEqual({ messageId: "m1", userId: "u1", emoji: "👍" });
  });

  it("keeps the name of a custom emoji", () => {
    expect(
      reactionTarget({ user_id: "u1", message_id: "m1", emoji: { id: "9", name: "pog" } }),
    ).toEqual({ messageId: "m1", userId: "u1", emoji: "pog" });
  });

  it("returns null when a field is missing", () => {
    expect(reactionTarget({ message_id: "m1", emoji: { name: "👍" } })).toBeNull();
    expect(reactionTarget({ user_id: "u1", message_id: "m1", emoji: {} })).toBeNull();
    expect(reactionTarget("MESSAGE_REACTION_ADD")).toBeNull();
    expect(reactionTarget(null)).toBeNull();
  });
});

describe("decideCorrection", () => {
  it("treats a reply above the threshold as a correction", async () => {
    const fetchFn = vi.fn().mockResolvedValue(booleanResponse(0.8));

    const decision = await decideCorrection(
      jevClient(fetchFn),
      "締め切りは来週です",
      "違うよ、今週だよ",
    );

    expect(decision).toEqual({ correction: true, fallback: false, probability: 0.8 });
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(body.state).toEqual({
      bot_message: "締め切りは来週です",
      reply: "違うよ、今週だよ",
    });
    expect(body.questions.q.type).toBe("noul");
    expect(body.questions.q.instructions).toBe(CORRECTION_QUESTION.instructions);
  });

  it("treats a reply below the threshold as not a correction", async () => {
    const fetchFn = vi.fn().mockResolvedValue(booleanResponse(0.2));

    const decision = await decideCorrection(jevClient(fetchFn), "どうした？", "ありがとう");

    expect(decision).toEqual({
      correction: false,
      fallback: false,
      probability: 0.2,
    });
  });

  it("counts the threshold itself as a correction", async () => {
    const fetchFn = vi.fn().mockResolvedValue(booleanResponse(CORRECTION_THRESHOLD));

    const decision = await decideCorrection(jevClient(fetchFn), "a", "b");

    expect(decision.correction).toBe(true);
  });

  it("falls back to not a correction when Jev cannot be reached", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

    const decision = await decideCorrection(jevClient(fetchFn), "a", "b");

    expect(decision).toEqual({ correction: false, fallback: true });
  });
});
