import type { TurnResult } from "@cloudflare/think";
import { describe, expect, it } from "vitest";
import { turnText } from "../src/task";

/** A turn result in the shape Think returns, with only the parts under test spelled out */
function turn(
  parts: Array<{ type: string; text?: string }>,
  status: TurnResult["status"] = "completed",
): TurnResult {
  return {
    requestId: "r1",
    status,
    continuation: false,
    message: { id: "m1", role: "assistant", parts },
  };
}

describe("turnText", () => {
  it("joins the text parts and ignores the tool parts", () => {
    const text = turnText(
      turn([
        { type: "text", text: "調べた" },
        { type: "tool-web_search" },
        { type: "text", text: "結果はこれ" },
      ]),
    );

    expect(text).toBe("調べた\n結果はこれ");
  });

  it("trims the text", () => {
    expect(turnText(turn([{ type: "text", text: "  答え  " }]))).toBe("答え");
  });

  it("returns null for a turn that is not completed or has no text", () => {
    expect(turnText(turn([], "error"))).toBeNull();
    expect(turnText(turn([]))).toBeNull();
  });
});
