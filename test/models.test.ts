import { describe, expect, it } from "vitest";
import { modelIds } from "../src/models";

describe("modelIds", () => {
  it("returns the code defaults when .dev.vars sets nothing", () => {
    expect(modelIds({})).toEqual({
      chat: "anthropic/claude-haiku-5.5",
      task: "deepseek/deepseek-v4.1-flash-1017",
      decide: "typesafe-ai/jev",
    });
  });

  it("lets .dev.vars override each role", () => {
    expect(
      modelIds({ CHAT_MODEL: "x/y", TASK_MODEL: "t/u", DECIDE_MODEL: "jev-test" }),
    ).toEqual({
      chat: "x/y",
      task: "t/u",
      decide: "jev-test",
    });
  });

  it("treats an empty value as not set", () => {
    expect(modelIds({ CHAT_MODEL: "" }).chat).toBe(
      "anthropic/claude-haiku-5.5",
    );
  });
});
