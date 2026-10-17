import { describe, expect, it } from "vitest";
import { modelIds } from "../src/models";

describe("modelIds", () => {
  it("returns the code defaults when .dev.vars sets nothing", () => {
    expect(modelIds({})).toEqual({
      chat: "anthropic/claude-haiku-5.5",
      image: "openai/gpt-image-1",
      decide: "jev-latest",
    });
  });

  it("lets .dev.vars override each role", () => {
    expect(
      modelIds({
        CHAT_MODEL: "x/y",
        IMAGE_MODEL: "a/b",
        DECIDE_MODEL: "jev-test",
      }),
    ).toEqual({ chat: "x/y", image: "a/b", decide: "jev-test" });
  });

  it("treats an empty value as not set", () => {
    expect(modelIds({ CHAT_MODEL: "" }).chat).toBe(
      "anthropic/claude-haiku-5.5",
    );
  });
});
