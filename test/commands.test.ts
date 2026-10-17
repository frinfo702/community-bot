import { describe, expect, it, vi } from "vitest";
import {
  MEMORY_COMMAND,
  parseMemoryCommand,
  parseMemoryInteraction,
  runMemoryCommand,
  SHOW_LIMIT,
  type MemoryStore,
} from "../src/commands";

const BOT_ID = "123456789";

function fakeStore(overrides: Partial<MemoryStore> = {}): MemoryStore {
  return {
    list: vi.fn(async () => []),
    forget: vi.fn(async () => "deleted" as const),
    forgetAll: vi.fn(async () => 0),
    ...overrides,
  };
}

describe("parseMemoryCommand", () => {
  it.each([
    ["!memory show", { action: "show" }],
    ["!memory forget m1", { action: "forget", target: "m1" }],
    ["!memory forget all", { action: "forget", target: "all" }],
    [`<@${BOT_ID}> memory show`, { action: "show" }],
    [`<@!${BOT_ID}> memory forget all`, { action: "forget", target: "all" }],
    ["!memory", { action: "help" }],
    ["!memory forget", { action: "help" }],
    ["!memory nope", { action: "help" }],
  ])("parses %s", (content, expected) => {
    expect(parseMemoryCommand(content, BOT_ID)).toEqual(expected);
  });

  it.each([
    "memory show",
    "!memories show",
    "!memoryx show",
    `こんにちは <@${BOT_ID}>`,
    "普通のメッセージ",
  ])("ignores %s", (content) => {
    expect(parseMemoryCommand(content, BOT_ID)).toBeNull();
  });
});

describe("runMemoryCommand", () => {
  it("shows the caller's memories with their ids", async () => {
    const store = fakeStore({
      list: vi.fn(async () => [
        { id: "m1", content: "ラーメンが好き" },
        { id: "m2", content: "猫を飼っている" },
      ]),
    });

    const reply = await runMemoryCommand({ action: "show" }, "u1", store);

    expect(reply).toContain("m1");
    expect(reply).toContain("ラーメンが好き");
    expect(reply).toContain("m2");
    expect(store.list).toHaveBeenCalledWith("u1", SHOW_LIMIT);
  });

  it("reports an empty memory list", async () => {
    const reply = await runMemoryCommand({ action: "show" }, "u1", fakeStore());

    expect(reply).toContain("まだありません");
  });

  it("deletes an own memory by id", async () => {
    const store = fakeStore();
    const reply = await runMemoryCommand(
      { action: "forget", target: "m1" },
      "u1",
      store,
    );

    expect(store.forget).toHaveBeenCalledWith("m1", "u1");
    expect(reply).toContain("削除しました");
  });

  it("refuses a memory owned by someone else", async () => {
    const store = fakeStore({ forget: vi.fn(async () => "not_owner" as const) });

    const reply = await runMemoryCommand(
      { action: "forget", target: "m1" },
      "u1",
      store,
    );

    expect(reply).toContain("削除できません");
  });

  it("reports an unknown id", async () => {
    const store = fakeStore({ forget: vi.fn(async () => "not_found" as const) });

    const reply = await runMemoryCommand(
      { action: "forget", target: "m9" },
      "u1",
      store,
    );

    expect(reply).toContain("見つかりません");
  });

  it("forgets all memories of the caller and reports the count", async () => {
    const store = fakeStore({ forgetAll: vi.fn(async () => 3) });

    const reply = await runMemoryCommand(
      { action: "forget", target: "all" },
      "u1",
      store,
    );

    expect(store.forgetAll).toHaveBeenCalledWith("u1");
    expect(reply).toContain("3件");
  });

  it("explains the usage for help", async () => {
    const reply = await runMemoryCommand({ action: "help" }, "u1", fakeStore());

    expect(reply).toContain("/memory show");
    expect(reply).toContain("/memory forget id:all");
    expect(reply).toContain("!memory show");
  });
});

describe("parseMemoryInteraction", () => {
  // Registration and parsing name the subcommands separately, so a new
  // subcommand in MEMORY_COMMAND must fail here until the parser knows it
  it("parses every subcommand the command registers", () => {
    for (const option of MEMORY_COMMAND.options) {
      const options = option.options?.map((child) => ({
        name: child.name,
        value: "m1",
      }));

      expect(parseMemoryInteraction([{ name: option.name, options }])).toMatchObject(
        { action: option.name },
      );
    }
  });

  it.each([
    [[{ name: "show", type: 1 }], { action: "show" }],
    [
      [
        {
          name: "forget",
          type: 1,
          options: [{ name: "id", type: 3, value: "m1" }],
        },
      ],
      { action: "forget", target: "m1" },
    ],
    [
      [
        {
          name: "forget",
          type: 1,
          options: [{ name: "id", type: 3, value: "all" }],
        },
      ],
      { action: "forget", target: "all" },
    ],
  ])("parses %j", (options, expected) => {
    expect(parseMemoryInteraction(options)).toEqual(expected);
  });

  it.each([
    undefined,
    [],
    [{ name: "clear", type: 1 }],
    [{ name: "forget", type: 1, options: [] }],
    [{ name: "forget", type: 1, options: [{ name: "id", type: 3 }] }],
  ])("falls back to help for %j", (options) => {
    expect(parseMemoryInteraction(options)).toEqual({ action: "help" });
  });
});
