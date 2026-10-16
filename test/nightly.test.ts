import { describe, expect, it, vi } from "vitest";
import type { Memory } from "../src/conversation";
import type { MemoryVerdict } from "../src/memory";
import {
  dayLabel,
  DECAY_AFTER_MS,
  NIGHTLY_CHUNK_MESSAGES,
  NIGHTLY_MAX_CHUNKS,
  NIGHTLY_STALE_LIMIT,
  nextNightlyAt,
  runNightlyConsolidation,
  type NightlyDeps,
  type NightlyRun,
  type NightlyStore,
} from "../src/nightly";
import type { LoggedMessage } from "../src/prompt";

const BOT = "1234567890";
const NOW = Date.UTC(2026, 9, 16, 18, 0, 0); // 2026-10-17 03:00 JST
const DAY = 24 * 60 * 60 * 1000;
const DIARY_LINE = "今日は和やかな一日だった";

function message(partial: Partial<LoggedMessage>): LoggedMessage {
  return {
    id: "1",
    channelId: "c1",
    authorId: "u1",
    authorName: "ken",
    isBot: false,
    content: "",
    createdAt: NOW - 1000,
    ...partial,
  };
}

function memory(id: string, userId: string, content: string, updatedAt = NOW): Memory {
  return { id, userId, content, createdAt: updatedAt, updatedAt };
}

/** Jev stub. The question shape tells worth / add / verdict / decay apart. */
function jevStub(options: {
  worth?: number;
  add?: number;
  verdicts?: Record<string, MemoryVerdict>;
  decay?: Record<string, "keep" | "delete">;
  fail?: boolean;
}) {
  const boolean = vi.fn(async (state: Record<string, unknown>) => {
    if (options.fail) return { ok: false as const, error: "unavailable" as const };
    const probability =
      "memories" in state ? (options.add ?? 0) : (options.worth ?? 0);
    return { ok: true as const, value: { probability } };
  });
  const choice = vi.fn(async (state: Record<string, unknown>) => {
    if (options.fail) return { ok: false as const, error: "unavailable" as const };
    if ("age_days" in state) {
      const id = (state.memory as { id: string }).id;
      return {
        ok: true as const,
        value: { choice: options.decay?.[id] ?? "keep", confidence: 0.9 },
      };
    }
    const id = (state.memory as { id: string }).id;
    return {
      ok: true as const,
      value: { choice: options.verdicts?.[id] ?? "keep", confidence: 0.9 },
    };
  });
  return { boolean, choice };
}

function makeStore(initial: Memory[] = [], day: LoggedMessage[] = []) {
  const rows = new Map(initial.map((row) => [row.id, { ...row }]));
  const store: NightlyStore = {
    memories: vi.fn(async (userId, limit) =>
      [...rows.values()].filter((row) => row.userId === userId).slice(0, limit),
    ),
    appendMemory: vi.fn(async (userId, content) => {
      const added = memory(`m${rows.size + 1}`, userId, content);
      rows.set(added.id, added);
      return added;
    }),
    updateMemory: vi.fn(async (id, content) => {
      const row = rows.get(id);
      if (!row) return null;
      const after = { ...row, content };
      rows.set(id, after);
      return after;
    }),
    deleteMemory: vi.fn(async (id) => rows.delete(id)),
    messagesSince: vi.fn(async (since, until) =>
      day.filter(
        (entry) => entry.createdAt >= since && entry.createdAt < until,
      ),
    ),
    staleMemories: vi.fn(async (before, limit) =>
      [...rows.values()]
        .filter((row) => row.updatedAt < before)
        .sort((a, b) => a.updatedAt - b.updatedAt)
        .slice(0, limit),
    ),
  };
  return { store, rows };
}

function deps(
  store: NightlyStore,
  jev: NightlyDeps["jev"],
  generate: NightlyDeps["generate"],
) {
  const record = vi.fn(async (run: NightlyRun) => ({
    id: 1,
    ...run,
    rolledBack: false,
  }));
  const log = vi.fn();
  return { store, jev, generate, record, log, botId: BOT, now: NOW };
}

/** The raw stub (for asserting on calls) cast to the client shape the deps need. */
function asJev(stub: ReturnType<typeof jevStub>): NightlyDeps["jev"] {
  return stub as unknown as NightlyDeps["jev"];
}

const KEN = [message({ id: "1", content: "土曜に作業している" })];
const MEI = [
  message({ id: "2", authorId: "u2", authorName: "mei", content: "猫が好き" }),
];

describe("runNightlyConsolidation", () => {
  it("merges each speaker's day and records the diary and summary", async () => {
    const { store, rows } = makeStore([], [...KEN, ...MEI]);
    const generate = vi.fn(async (messages: Array<{ content: string }>) => {
      if (messages[0].content.includes("diary")) return DIARY_LINE;
      return messages[1].content.includes("作業") ? "土曜に作業する" : "猫が好き";
    }) as unknown as NightlyDeps["generate"];
    const d = deps(store, asJev(jevStub({ worth: 0.9 })), generate);

    const run = await runNightlyConsolidation(d);

    expect(run?.day).toBe("2026-10-16");
    expect(run?.diary).toBe(DIARY_LINE);
    expect(run?.summary).toMatchObject({
      messages: 2,
      speakers: 2,
      decayed: [],
    });
    expect(run?.summary.changes.map((change) => change.action)).toEqual([
      "add",
      "add",
    ]);
    expect([...rows.values()].map((row) => row.content).sort()).toEqual([
      "土曜に作業する",
      "猫が好き",
    ]);
    // Changes are recorded under the nightly actor so they can be rolled back
    expect(store.appendMemory).toHaveBeenCalledWith(
      "u1",
      "土曜に作業する",
      "nightly",
      expect.any(String),
    );
    // The summary goes to the log with counts and targets
    const logged = d.log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain("add=2 update=0 delete=0");
    expect(logged).toContain("diary=" + DIARY_LINE);
  });

  it("applies Jev's update and delete verdicts to existing memories", async () => {
    const { store, rows } = makeStore(
      [
        memory("a", "u1", "古い記憶", NOW - 1),
        memory("b", "u1", "消す記憶", NOW - 1),
      ],
      KEN,
    );
    const generate = vi.fn().mockResolvedValue("新しい記憶");
    const d = deps(
      store,
      asJev(
        jevStub({ worth: 0.9, add: 0, verdicts: { a: "update", b: "delete" } }),
      ),
      generate,
    );

    const run = await runNightlyConsolidation(d);

    expect(run?.summary.changes.map((c) => [c.action, c.recordId])).toEqual([
      ["delete", "b"],
      ["update", "a"],
    ]);
    expect(rows.get("a")?.content).toBe("新しい記憶");
    expect(rows.has("b")).toBe(false);
  });

  it("drops only the stale memories Jev marks for deletion", async () => {
    const { store, rows } = makeStore(
      [
        memory("old1", "u1", "昔の雑談", NOW - DECAY_AFTER_MS - DAY),
        memory("old2", "u1", "続いている話", NOW - DECAY_AFTER_MS - DAY),
        memory("new1", "u1", "最近の話", NOW - DAY),
      ],
      KEN,
    );
    const jev = jevStub({ worth: 0.1, decay: { old1: "delete", old2: "keep" } });
    const d = deps(store, asJev(jev), vi.fn());

    const run = await runNightlyConsolidation(d);

    expect(store.staleMemories).toHaveBeenCalledWith(
      NOW - DECAY_AFTER_MS,
      NIGHTLY_STALE_LIMIT,
    );
    expect(rows.has("old1")).toBe(false);
    expect(rows.has("old2")).toBe(true);
    expect(rows.has("new1")).toBe(true);
    expect(run?.summary.decayed).toEqual(["old1"]);
    // The decay decision is Jev's; the age is passed as state
    const state = jev.choice.mock.calls[0][0] as { age_days: number };
    expect(state.age_days).toBe(31);
  });

  it("keeps each speaker's day inside the window caps", async () => {
    const day = Array.from({ length: 40 }, (_, i) =>
      message({
        id: `m${i}`,
        content: `topic-${String(i).padStart(2, "0")}`,
      }),
    );
    const { store } = makeStore([], day);
    const writes: string[] = [];
    const generate = vi.fn(async (messages: Array<{ content: string }>) => {
      if (messages[0].content.includes("diary")) return DIARY_LINE;
      writes.push(messages[1].content);
      return `記憶${writes.length}`;
    });
    const d = deps(
      store,
      asJev(jevStub({ worth: 0.9, add: 0.9 })),
      generate as unknown as NightlyDeps["generate"],
    );

    await runNightlyConsolidation(d);

    const windows = 40 / NIGHTLY_CHUNK_MESSAGES;
    const used = Math.min(windows, NIGHTLY_MAX_CHUNKS);
    expect(store.memories).toHaveBeenCalledTimes(used);
    expect(store.appendMemory).toHaveBeenCalledTimes(used);
    // Only the newest windows reach the LLM; the oldest messages are dropped
    const prompts = writes.join("\n");
    expect(prompts).toContain("topic-39");
    expect(prompts).not.toContain("topic-00");
  });

  it("skips the run when the day has no messages", async () => {
    const { store } = makeStore();
    const d = deps(store, asJev(jevStub({ worth: 0.9 })), vi.fn());

    expect(await runNightlyConsolidation(d)).toBeNull();
    expect(d.record).not.toHaveBeenCalled();
    expect(d.log).toHaveBeenCalledWith("no messages; skipped");
  });

  it("records the run even when Jev and the LLM fail", async () => {
    const { store, rows } = makeStore(
      [memory("old1", "u1", "昔の雑談", NOW - DECAY_AFTER_MS - DAY)],
      KEN,
    );
    const generate = vi.fn().mockRejectedValue(new Error("gateway down"));
    const d = deps(store, asJev(jevStub({ fail: true })), generate);

    const run = await runNightlyConsolidation(d);

    expect(run).not.toBeNull();
    expect(run?.diary).toBe("");
    expect(run?.summary.changes).toEqual([]);
    expect(rows.has("old1")).toBe(true);
    expect(d.log.mock.calls.map((call) => String(call[0])).join("\n")).toContain(
      "diary failed: gateway down",
    );
  });
});

describe("nightly schedule", () => {
  it("fires at 18:00 UTC (03:00 JST) every day", () => {
    expect(nextNightlyAt(Date.UTC(2026, 9, 16, 0, 0, 0))).toBe(
      Date.UTC(2026, 9, 16, 18, 0, 0),
    );
    expect(nextNightlyAt(Date.UTC(2026, 9, 16, 18, 0, 0))).toBe(
      Date.UTC(2026, 9, 17, 18, 0, 0),
    );
  });

  it("labels the window start with the JST date", () => {
    expect(dayLabel(Date.UTC(2026, 9, 15, 18, 0, 0))).toBe("2026-10-16");
    expect(dayLabel(Date.UTC(2026, 9, 16, 18, 0, 0))).toBe("2026-10-17");
  });
});
