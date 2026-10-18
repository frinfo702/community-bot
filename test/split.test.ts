import { describe, expect, it } from "vitest";
import { SPLIT_MARKER, splitReply } from "../src/split";

describe("splitReply", () => {
  it("keeps a reply without the marker as one message", () => {
    expect(splitReply("その話、わしも知っておる")).toEqual([
      "その話、わしも知っておる",
    ]);
  });

  it("splits on a marker line and trims the parts", () => {
    const text = `まずは結論じゃ\n\n${SPLIT_MARKER}\n\n詳しい話はこうじゃ`;
    expect(splitReply(text)).toEqual(["まずは結論じゃ", "詳しい話はこうじゃ"]);
  });

  it("merges a third part back into the second, so a reply stays short", () => {
    const text = ["一", "二", "三", "四"].join(`\n${SPLIT_MARKER}\n`);
    expect(splitReply(text)).toEqual(["一", "二", "三\n\n四"]);
  });

  it("drops empty parts and the marker at either end", () => {
    const text = `${SPLIT_MARKER}\n\n本文\n\n${SPLIT_MARKER}`;
    expect(splitReply(text)).toEqual(["本文"]);
  });

  it("returns nothing for empty text", () => {
    expect(splitReply("  \n ")).toEqual([]);
  });
});
