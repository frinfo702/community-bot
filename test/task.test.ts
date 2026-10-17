import type { TurnResult } from "@cloudflare/think";
import { describe, expect, it, vi } from "vitest";
import { runTask, turnText } from "../src/task";

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

  it("returns null for a turn that is not completed or has no text", () => {
    expect(turnText(turn([], "error"))).toBeNull();
    expect(turnText(turn([]))).toBeNull();
  });
});

describe("runTask", () => {
  it("returns the assistant text and the elapsed time", async () => {
    const ask = vi.fn().mockResolvedValue(turn([{ type: "text", text: "  答え  " }]));

    const task = await runTask("依頼", ask);

    expect(ask).toHaveBeenCalledWith("依頼");
    expect(task?.text).toBe("答え");
    expect(task?.ms).toBeGreaterThanOrEqual(0);
  });

  it("returns null when the turn did not complete (text reply fallback)", async () => {
    expect(await runTask("依頼", async () => turn([], "error"))).toBeNull();
  });

  it("returns null and logs when the agent throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(
      await runTask("依頼", async () => {
        throw new Error("boom");
      }),
    ).toBeNull();
    expect(error).toHaveBeenCalledWith("task agent failed", expect.any(Error));
    error.mockRestore();
  });
});
