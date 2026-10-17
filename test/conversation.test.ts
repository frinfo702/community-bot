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
  const stamp = new Map<
    string,
    { scope: string; category: string; version: string; ranking: string }
  >();
  const guild = new Map<string, { list: string; fetched_at: number }>();

  const sql = {
    exec(query: string, ...args: unknown[]) {
      const q = query.replace(/\s+/g, " ").trim();
      const rows = (...result: unknown[]) => ({ toArray: () => result });

      if (q.startsWith("CREATE")) {
        return rows();
      }
      // The constructor checks for and adds the reason column (ISSUE-1869)
      if (q.startsWith("PRAGMA table_info(memory_log)")) {
        return rows();
      }
      if (q.startsWith("ALTER TABLE")) {
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
      if (q.startsWith("INSERT OR REPLACE INTO stamp_emoji_cache")) {
        const [scope, category, version, ranking] = args as string[];
        stamp.set(`${scope}/${category}`, { scope, category, version, ranking });
        return rows();
      }
      if (q.startsWith("SELECT ranking FROM stamp_emoji_cache")) {
        const [scope, category, version] = args as string[];
        const row = stamp.get(`${scope}/${category}`);
        return rows(row && row.version === version ? row : undefined);
      }
      if (q.startsWith("INSERT OR REPLACE INTO guild_emojis")) {
        const [scope, list, fetched_at] = args as string[];
        guild.set(scope, { list, fetched_at: Number(fetched_at) });
        return rows();
      }
      if (q.startsWith("SELECT list, fetched_at FROM guild_emojis")) {
        return rows(guild.get(args[0] as string));
      }
      throw new Error(`unexpected SQL: ${q}`);
    },
  };

  const ctx = {
    storage: {
      sql,
      // The constructor keeps the nightly alarm scheduled (ISSUE-1874)
      getAlarm: async () => null,
      setAlarm: async () => {},
    },
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
  it("lists only the caller's memories", async () => {
    const { conversation } = createDO();
    await conversation.appendMemory("u1", "u1 memory", "command");
    await conversation.appendMemory("u2", "u2 memory", "command");

    const rows = await conversation.memories("u1", 10, "command");

    expect(rows.map((row) => row.content)).toEqual(["u1 memory"]);
  });

  it("refuses to delete another user's memory", async () => {
    const { conversation, memories, log } = createDO();
    const other = await conversation.appendMemory("u2", "u2 memory", "command");

    expect(await conversation.forgetMemory(other.id, "u1", "command")).toBe(
      "not_owner",
    );
    expect(memories.has(other.id)).toBe(true);
    expect(deleteLogs(log)).toEqual([]);
  });

  it("deletes the caller's memory and logs delete / command", async () => {
    const { conversation, memories, log } = createDO();
    const own = await conversation.appendMemory("u1", "u1 memory", "command");

    expect(await conversation.forgetMemory(own.id, "u1", "command")).toBe(
      "deleted",
    );

    expect(memories.has(own.id)).toBe(false);
    expect(deleteLogs(log)).toEqual([
      { recordId: own.id, userId: "u1", actor: "command" },
    ]);
  });

  it("returns not_found for an unknown id", async () => {
    const { conversation, log } = createDO();

    expect(await conversation.forgetMemory("missing", "u1", "command")).toBe(
      "not_found",
    );
    expect(deleteLogs(log)).toEqual([]);
  });

  it("forgetAllMemories deletes only the caller's and logs each one", async () => {
    const { conversation, memories, log } = createDO();
    const a = await conversation.appendMemory("u1", "a", "command");
    const b = await conversation.appendMemory("u1", "b", "command");
    const other = await conversation.appendMemory("u2", "u2 memory", "command");

    expect(await conversation.forgetAllMemories("u1", "command")).toBe(2);

    expect(memories.has(a.id)).toBe(false);
    expect(memories.has(b.id)).toBe(false);
    expect(memories.has(other.id)).toBe(true);
    expect(deleteLogs(log)).toEqual([
      { recordId: a.id, userId: "u1", actor: "command" },
      { recordId: b.id, userId: "u1", actor: "command" },
    ]);
  });
});

describe("ConversationDO stamp cache methods", () => {
  it("caches a ranking per scope, category and version", async () => {
    const { conversation } = createDO();

    await conversation.saveStampRanking("g1", "laugh", "v1", ["😂", "🤣"]);

    expect(await conversation.stampRanking("g1", "laugh", "v1")).toEqual([
      "😂",
      "🤣",
    ]);
    // A catalog or custom emoji change invalidates the row
    expect(await conversation.stampRanking("g1", "laugh", "v2")).toBeNull();
    expect(await conversation.stampRanking("g1", "think", "v1")).toBeNull();
    expect(await conversation.stampRanking("g2", "laugh", "v1")).toBeNull();
  });

  it("reuses the guild emoji list only while it is fresh", async () => {
    const { conversation } = createDO();
    const emojis = [{ id: "1", name: "kusa" }];

    expect(await conversation.guildEmojis("g1", 1000)).toBeNull();
    await conversation.saveGuildEmojis("g1", emojis);

    expect(await conversation.guildEmojis("g1", 60_000)).toEqual(emojis);
    expect(await conversation.guildEmojis("g1", -1)).toBeNull();
  });
});
