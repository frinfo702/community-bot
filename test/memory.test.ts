import { describe, expect, it, vi } from "vitest";
import type { Memory } from "../src/conversation";
import { JevClient } from "../src/jev";
import {
  extractMemories,
  type MemoryExtractionDeps,
  type MemoryStore,
  type MemoryVerdict,
} from "../src/memory";
import type { LoggedMessage } from "../src/prompt";

const BOT = "1234567890";
const USER = "u1";
const NAME = "ken";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function message(partial: Partial<LoggedMessage>): LoggedMessage {
  return {
    id: "1",
    channelId: "c1",
    authorId: USER,
    authorName: NAME,
    isBot: false,
    content: "",
    createdAt: 0,
    ...partial,
  };
}

function memory(id: string, content: string): Memory {
  return { id, userId: USER, content, createdAt: 0, updatedAt: 0 };
}

/** Jev を fetch のモックで置き換える。boolean は state の形で worth / add を見分ける。 */
function jevFetch(options: {
  worth: number;
  add?: number;
  verdicts?: Record<string, MemoryVerdict>;
}) {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as {
      state: Record<string, unknown>;
      questions: { q: { type: string } };
    };
    const question = body.questions.q;
    if (question.type === "noul") {
      // 既存記憶つきの state は add の質問
      const probability =
        "memories" in body.state ? (options.add ?? 0) : options.worth;
      return jsonResponse(200, {
        answers: { q: { type: "noul", noul: probability } },
      });
    }
    const target = body.state.memory as { id: string };
    return jsonResponse(200, {
      answers: {
        q: {
          type: "choice",
          choice: options.verdicts?.[target.id] ?? "keep",
          confidence: 0.9,
        },
      },
    });
  });
}

function makeStore(initial: Memory[] = []) {
  const rows = [...initial];
  const reasons: string[] = [];
  const store: MemoryStore = {
    memories: vi.fn(async (_userId, _limit, _actor, reason) => {
      if (reason) reasons.push(reason);
      return [...rows];
    }),
    appendMemory: vi.fn(async (userId, content, _actor, reason) => {
      if (reason) reasons.push(reason);
      const added = memory(`m${rows.length + 1}`, content);
      rows.push({ ...added, userId });
      return added;
    }),
    updateMemory: vi.fn(async (id, content, _actor, reason) => {
      if (reason) reasons.push(reason);
      const index = rows.findIndex((row) => row.id === id);
      if (index < 0) return null;
      rows[index] = { ...rows[index], content };
      return rows[index];
    }),
    deleteMemory: vi.fn(async (id, _actor, reason) => {
      if (reason) reasons.push(reason);
      const index = rows.findIndex((row) => row.id === id);
      if (index < 0) return false;
      rows.splice(index, 1);
      return true;
    }),
  };
  return { store, rows, reasons };
}

function deps(
  fetchFn: ReturnType<typeof jevFetch>,
  store: MemoryStore,
  generate: (messages: unknown) => Promise<string>,
): MemoryExtractionDeps {
  return {
    jev: new JevClient({
      apiKey: "k",
      model: "jev-latest",
      fetchFn: fetchFn as unknown as typeof fetch,
    }),
    store,
    generate: generate as MemoryExtractionDeps["generate"],
  };
}

function input(messages: LoggedMessage[]) {
  return { userId: USER, userName: NAME, messages, botId: BOT };
}

const EXCHANGE = [
  message({ id: "1", content: "やあ" }),
  message({ id: "2", content: ` <@${BOT}> 俺は土曜の午後にしか作業しないタイプ` }),
  message({ id: "3", isBot: true, authorName: "bot", content: "なるほど" }),
];

describe("extractMemories", () => {
  it("adds a memory that the LLM writes from the exchange", async () => {
    const fetchFn = jevFetch({ worth: 0.9 });
    const { store, rows, reasons } = makeStore();
    const generate = vi.fn().mockResolvedValue("土曜の午後に作業するタイプ");

    const result = await extractMemories(
      deps(fetchFn, store, generate),
      input(EXCHANGE),
    );

    expect(result.worthRemembering).toBe(true);
    expect(result.changes).toEqual([
      {
        action: "add",
        recordId: "m1",
        reason: expect.stringContaining("add"),
      },
    ]);
    expect(rows.map((row) => row.content)).toEqual([
      "土曜の午後に作業するタイプ",
    ]);
    // 理由が memory_log 用にストアへ渡る
    expect(reasons.some((reason) => reason.includes("add"))).toBe(true);
    // LLM に渡るのは直近のやり取りだけ
    const messages = generate.mock.calls[0][0] as Array<{ content: string }>;
    expect(messages.map((m) => m.content).join("\n")).toContain(
      "土曜の午後にしか作業しないタイプ",
    );
  });

  it("updates only the record Jev pointed at", async () => {
    const fetchFn = jevFetch({
      worth: 0.9,
      add: 0,
      verdicts: { a: "update" },
    });
    const { store, rows } = makeStore([
      memory("a", "研究は平日に進めている"),
      memory("b", "猫が好き"),
    ]);
    const generate = vi.fn().mockResolvedValue("土曜の午後に作業する");

    const result = await extractMemories(
      deps(fetchFn, store, generate),
      input(EXCHANGE),
    );

    expect(result.changes.map((change) => [change.action, change.recordId])).toEqual([
      ["update", "a"],
    ]);
    expect(rows.map((row) => row.content)).toEqual([
      "土曜の午後に作業する",
      "猫が好き",
    ]);
    // LLM には update 対象のレコードとやり取りだけを渡す（他の記憶は渡さない）
    const messages = generate.mock.calls[0][0] as Array<{ content: string }>;
    const prompt = messages.map((m) => m.content).join("\n");
    expect(prompt).toContain("研究は平日に進めている");
    expect(prompt).not.toContain("猫が好き");
  });

  it("deletes the record Jev pointed at", async () => {
    const fetchFn = jevFetch({ worth: 0.9, verdicts: { a: "delete" } });
    const { store, rows } = makeStore([memory("a", "修士をやめるつもり")]);
    const generate = vi.fn();

    const result = await extractMemories(
      deps(fetchFn, store, generate),
      input(EXCHANGE),
    );

    expect(result.changes.map((change) => change.action)).toEqual(["delete"]);
    expect(rows).toEqual([]);
    // 削除は文面を作らない
    expect(generate).not.toHaveBeenCalled();
  });

  it("does nothing when Jev says the exchange is not worth keeping", async () => {
    const fetchFn = jevFetch({ worth: 0.1 });
    const { store, rows } = makeStore([memory("a", "猫が好き")]);
    const generate = vi.fn();

    const result = await extractMemories(
      deps(fetchFn, store, generate),
      input(EXCHANGE),
    );

    expect(result).toEqual({ worthRemembering: false, changes: [] });
    expect(store.memories).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("does nothing when Jev is unavailable", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const { store, rows } = makeStore();
    const generate = vi.fn();

    const result = await extractMemories(
      deps(fetchFn as ReturnType<typeof jevFetch>, store, generate),
      input(EXCHANGE),
    );

    expect(result).toEqual({ worthRemembering: false, changes: [] });
    expect(store.memories).not.toHaveBeenCalled();
    expect(rows).toEqual([]);
  });

  it("keeps the memory when the LLM refuses to write", async () => {
    const fetchFn = jevFetch({ worth: 0.9, verdicts: { a: "update" } });
    const { store, rows } = makeStore([memory("a", "猫が好き")]);
    const generate = vi.fn().mockResolvedValue("NONE");

    const result = await extractMemories(
      deps(fetchFn, store, generate),
      input(EXCHANGE),
    );

    expect(result.changes).toEqual([]);
    expect(rows[0].content).toBe("猫が好き");
    expect(store.updateMemory).not.toHaveBeenCalled();
  });

  it("does not ask Jev anything for an empty exchange", async () => {
    const fetchFn = jevFetch({ worth: 0.9 });
    const { store } = makeStore();

    const result = await extractMemories(
      deps(fetchFn, store, vi.fn()),
      input([]),
    );

    expect(result).toEqual({ worthRemembering: false, changes: [] });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
