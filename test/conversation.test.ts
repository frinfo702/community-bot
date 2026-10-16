import { describe, expect, it } from "vitest";
import { ConversationDO } from "../src/conversation";
import type { Env } from "../src/env";

interface Row {
  id: string;
  user_id: string;
  content: string;
  created_at: number;
  updated_at: number;
}

/** Minimal SQL storage fake that only remembers memories / memory_log. */
function createDO() {
  const memories = new Map<string, Row>();
  const log: unknown[][] = [];

  const sql = {
    exec(query: string, ...args: unknown[]) {
      const q = query.replace(/\s+/g, " ").trim();
      const rows = (...result: unknown[]) => ({ toArray: () => result });

      if (q.startsWith("CREATE TABLE") || q.startsWith("CREATE INDEX")) {
        return rows();
      }
      if (q.startsWith("INSERT INTO memories")) {
        const [id, user_id, content, created_at, updated_at] = args as string[];
        memories.set(id, {
          id,
          user_id,
          content,
          created_at: Number(created_at),
          updated_at: Number(updated_at),
        });
        return rows();
      }
      if (q.startsWith("SELECT * FROM memories WHERE id = ?")) {
        return rows(memories.get(args[0] as string));
      }
      if (q.startsWith("SELECT * FROM memories WHERE user_id = ?")) {
        return rows(
          ...[...memories.values()].filter((row) => row.user_id === args[0]),
        );
      }
      if (q.startsWith("SELECT id FROM memories WHERE user_id = ?")) {
        return rows(
          ...[...memories.values()]
            .filter((row) => row.user_id === args[0])
            .map((row) => ({ id: row.id })),
        );
      }
      if (q.startsWith("DELETE FROM memories WHERE id = ?")) {
        memories.delete(args[0] as string);
        return rows();
      }
      if (q.startsWith("INSERT INTO memory_log")) {
        log.push(args);
        return rows();
      }
      throw new Error(`unexpected SQL: ${q}`);
    },
  };

  const ctx = {
    storage: { sql },
    blockConcurrencyWhile: async (fn: () => Promise<void>) => {
      await fn();
    },
  };

  return {
    conversation: new ConversationDO(
      ctx as unknown as DurableObjectState,
      {} as Env,
    ),
    memories,
    log,
  };
}

const deleteLogs = (log: unknown[][]) =>
  log
    .filter((args) => args[0] === "delete")
    .map((args) => ({ recordId: args[2], userId: args[3], actor: args[6] }));

describe("ConversationDO memory command methods", () => {
  it("lists only the caller's memories", () => {
    const { conversation } = createDO();
    conversation.appendMemory("u1", "u1 memory", "command");
    conversation.appendMemory("u2", "u2 memory", "command");

    const rows = conversation.memories("u1", 10, "command");

    expect(rows.map((row) => row.content)).toEqual(["u1 memory"]);
  });

  it("refuses to delete another user's memory", () => {
    const { conversation, memories, log } = createDO();
    const other = conversation.appendMemory("u2", "u2 memory", "command");

    expect(conversation.forgetMemory(other.id, "u1", "command")).toBe(
      "not_owner",
    );
    expect(memories.has(other.id)).toBe(true);
    expect(deleteLogs(log)).toEqual([]);
  });

  it("deletes the caller's memory and logs delete / command", () => {
    const { conversation, memories, log } = createDO();
    const own = conversation.appendMemory("u1", "u1 memory", "command");

    expect(conversation.forgetMemory(own.id, "u1", "command")).toBe("deleted");

    expect(memories.has(own.id)).toBe(false);
    expect(deleteLogs(log)).toEqual([
      { recordId: own.id, userId: "u1", actor: "command" },
    ]);
  });

  it("returns not_found for an unknown id", () => {
    const { conversation, log } = createDO();

    expect(conversation.forgetMemory("missing", "u1", "command")).toBe(
      "not_found",
    );
    expect(deleteLogs(log)).toEqual([]);
  });

  it("forgetAllMemories deletes only the caller's and logs each one", () => {
    const { conversation, memories, log } = createDO();
    const a = conversation.appendMemory("u1", "a", "command");
    const b = conversation.appendMemory("u1", "b", "command");
    const other = conversation.appendMemory("u2", "u2 memory", "command");

    expect(conversation.forgetAllMemories("u1", "command")).toBe(2);

    expect(memories.has(a.id)).toBe(false);
    expect(memories.has(b.id)).toBe(false);
    expect(memories.has(other.id)).toBe(true);
    expect(deleteLogs(log)).toEqual([
      { recordId: a.id, userId: "u1", actor: "command" },
      { recordId: b.id, userId: "u1", actor: "command" },
    ]);
  });
});
