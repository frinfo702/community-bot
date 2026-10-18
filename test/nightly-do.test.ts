import { describe, expect, it } from "vitest";
import { ConversationDO } from "../src/conversation";
import type { Env } from "../src/env";

interface MemoryRow {
  id: string;
  user_id: string;
  content: string;
  created_at: number;
  updated_at: number;
}

interface LogRow {
  id: number;
  action: string;
  record_id: string;
  user_id: string;
  before: string | null;
  after: string | null;
  actor: string;
  reason: string | null;
  created_at: number;
}

const DAY = 24 * 60 * 60 * 1000;

const ENV = {
  AI_GATEWAY_API_KEY: "k",
  DISCORD_APPLICATION_ID: "bot",
} as Env;

/** Minimal SQL storage fake covering the nightly methods and the colder memory paths. */
function createDO() {
  const memories = new Map<string, MemoryRow>();
  const messages: Array<Record<string, unknown>> = [];
  const logs: LogRow[] = [];
  const runs: Array<Record<string, unknown>> = [];
  const alarms: number[] = [];
  let memoryLogId = 1;
  let nightlyRunId = 1;

  const sql = {
    exec(query: string, ...args: unknown[]) {
      const q = query.replace(/\s+/g, " ").trim();
      const rows = (...result: unknown[]) => ({ toArray: () => result });

      if (q.startsWith("CREATE") || q.startsWith("ALTER TABLE")) return rows();
      if (q.startsWith("PRAGMA table_info(")) return rows();

      if (q.startsWith("INSERT OR REPLACE INTO messages")) {
        const [id, channel_id, author_id, author_name, is_bot, content, created_at] =
          args;
        messages.push({
          id,
          channel_id,
          author_id,
          author_name,
          is_bot: Number(is_bot),
          content,
          created_at: Number(created_at),
        });
        return rows();
      }
      if (q.startsWith("SELECT * FROM messages WHERE is_bot = 0")) {
        const [since, until] = args as number[];
        return rows(
          ...messages
            .filter(
              (row) =>
                row.is_bot === 0 &&
                Number(row.created_at) >= since &&
                Number(row.created_at) < until,
            )
            .sort((a, b) => Number(a.created_at) - Number(b.created_at)),
        );
      }

      if (q.startsWith("INSERT INTO memories")) {
        const [id, user_id, content, created_at, updated_at] = args as [
          string,
          string,
          string,
          number,
          number,
        ];
        memories.set(id, { id, user_id, content, created_at, updated_at });
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
      if (q.startsWith("SELECT * FROM memories WHERE updated_at < ?")) {
        const [before, limit] = args as number[];
        return rows(
          ...[...memories.values()]
            .filter((row) => row.updated_at < before)
            .sort((a, b) => a.updated_at - b.updated_at)
            .slice(0, limit),
        );
      }
      if (q.startsWith("UPDATE memories SET content = ?")) {
        const [content, updated_at, id] = args;
        const row = memories.get(id as string);
        if (row) {
          row.content = content as string;
          row.updated_at = Number(updated_at);
        }
        return rows();
      }
      if (q.startsWith("DELETE FROM memories WHERE id = ?")) {
        memories.delete(args[0] as string);
        return rows();
      }

      if (q.startsWith("INSERT INTO memory_log")) {
        const [action, , record_id, user_id, before, after, actor, reason, created_at] =
          args;
        logs.push({
          id: memoryLogId++,
          action: action as string,
          record_id: record_id as string,
          user_id: user_id as string,
          before: before as string | null,
          after: after as string | null,
          actor: actor as string,
          reason: reason as string | null,
          created_at: Number(created_at),
        });
        return rows();
      }
      if (q.startsWith("SELECT * FROM memory_log WHERE")) {
        const [since, until] = args as number[];
        return rows(
          ...logs
            .filter(
              (row) =>
                row.actor === "nightly" &&
                ["add", "update", "delete"].includes(row.action) &&
                row.created_at >= since &&
                row.created_at <= until,
            )
            .sort((a, b) => b.id - a.id),
        );
      }

      if (q.startsWith("INSERT INTO nightly_runs")) {
        const [day, diary, summary, started_at, finished_at] = args;
        runs.push({
          id: nightlyRunId++,
          day,
          diary,
          summary,
          started_at: Number(started_at),
          finished_at: Number(finished_at),
          rolled_back: 0,
        });
        return rows();
      }
      if (q.startsWith("SELECT last_insert_rowid()")) {
        return rows({ id: nightlyRunId - 1 });
      }
      if (q.startsWith("SELECT * FROM nightly_runs WHERE id = ?")) {
        return rows(runs.find((row) => row.id === args[0]));
      }
      if (q.startsWith("SELECT * FROM nightly_runs ORDER BY id DESC LIMIT 1")) {
        return rows(runs[runs.length - 1]);
      }
      if (q.startsWith("UPDATE nightly_runs SET rolled_back = 1")) {
        const run = runs.find((row) => row.id === args[0]);
        if (run) run.rolled_back = 1;
        return rows();
      }

      throw new Error(`unexpected SQL: ${q}`);
    },
  };

  const ctx = {
    storage: {
      sql,
      // The constructor keeps the nightly alarm scheduled (ISSUE-1874)
      getAlarm: async () => alarms[alarms.length - 1] ?? null,
      setAlarm: async (time: number) => {
        alarms.push(time);
      },
    },
    blockConcurrencyWhile: async (fn: () => Promise<void>) => {
      await fn();
    },
  };

  return {
    conversation: new ConversationDO(
      ctx as unknown as DurableObjectState,
      ENV,
    ),
    memories,
    messages,
    logs,
    runs,
    alarms,
  };
}

function message(id: string, createdAt: number, isBot = false) {
  return {
    id,
    channelId: "c1",
    authorId: "u1",
    authorName: "ken",
    isBot,
    content: `body-${id}`,
    createdAt,
  };
}

const run = (startedAt: number, finishedAt: number) => ({
  day: "2026-10-16",
  diary: "平穏な一日",
  summary: { messages: 1, speakers: 1, changes: [], decayed: [] },
  startedAt,
  finishedAt,
});

describe("ConversationDO nightly methods", () => {
  it("returns non-bot messages in the window, oldest first", async () => {
    const { conversation } = createDO();
    conversation.append(message("1", 100));
    conversation.append(message("2", 200, true));
    conversation.append(message("3", 300));
    conversation.append(message("4", 400));

    const rows = await conversation.messagesSince(50, 350);

    expect(rows.map((row) => row.id)).toEqual(["1", "3"]);
    expect(rows[0]).toMatchObject({ authorName: "ken", isBot: false });
  });

  it("returns stale memories oldest first, honoring the limit", async () => {
    const { conversation, memories } = createDO();
    const a = await conversation.appendMemory("u1", "a", "command");
    const b = await conversation.appendMemory("u1", "b", "command");
    memories.get(a.id)!.updated_at = 10;
    memories.get(b.id)!.updated_at = 20;

    expect((await conversation.staleMemories(30, 10)).map((row) => row.id)).toEqual([
      a.id,
      b.id,
    ]);
    expect((await conversation.staleMemories(15, 10)).map((row) => row.id)).toEqual([
      a.id,
    ]);
    expect((await conversation.staleMemories(30, 1)).map((row) => row.id)).toEqual([
      a.id,
    ]);
  });

  it("records a run and rolls back its add / update / delete", async () => {
    const { conversation, memories, logs, runs } = createDO();
    const t0 = Date.now();
    const updated = await conversation.appendMemory("u1", "v1", "command");
    const added = await conversation.appendMemory("u2", "added", "nightly");
    await conversation.updateMemory(updated.id, "v2", "nightly", "Jev");
    const removed = await conversation.appendMemory("u1", "removed", "command");
    await conversation.deleteMemory(removed.id, "nightly", "Jev");
    const record = await conversation.recordNightlyRun(
      run(t0, Date.now()),
    );

    expect(record).toMatchObject({ id: 1, day: "2026-10-16", rolledBack: false });
    expect(runs[0].summary).toBe(JSON.stringify(record.summary));

    const result = await conversation.rollbackNightlyRun();

    expect(result).toEqual({
      runId: 1,
      day: "2026-10-16",
      reversed: 3,
      skipped: 0,
      alreadyRolledBack: false,
    });
    expect(memories.has(added.id)).toBe(false);
    expect(memories.get(updated.id)?.content).toBe("v1");
    expect(memories.get(removed.id)?.content).toBe("removed");
    // The undo itself is logged so the history stays traceable
    expect(
      logs.filter((row) => row.action === "rollback").map((row) => row.actor),
    ).toEqual(["nightly", "nightly", "nightly"]);
  });

  it("does not roll back the same run twice", async () => {
    const { conversation, memories } = createDO();
    const t0 = Date.now();
    const added = await conversation.appendMemory("u1", "added", "nightly");
    await conversation.recordNightlyRun(run(t0, Date.now()));

    expect((await conversation.rollbackNightlyRun())?.reversed).toBe(1);
    const second = await conversation.rollbackNightlyRun();

    expect(second).toMatchObject({ reversed: 0, alreadyRolledBack: true });
    expect(memories.has(added.id)).toBe(false);
  });

  it("skips a record that changed again after the run", async () => {
    const { conversation, memories } = createDO();
    const t0 = Date.now();
    const memory = await conversation.appendMemory("u1", "v1", "command");
    await conversation.updateMemory(memory.id, "v2", "nightly", "Jev");
    const record = await conversation.recordNightlyRun(run(t0, Date.now()));
    // A later extraction wins over the rollback
    await conversation.updateMemory(memory.id, "v3", "extraction");

    const result = await conversation.rollbackNightlyRun(record.id);

    expect(result).toMatchObject({ reversed: 0, skipped: 1 });
    expect(memories.get(memory.id)?.content).toBe("v3");
  });

  it("returns null for an unknown run id", async () => {
    const { conversation } = createDO();

    expect(await conversation.rollbackNightlyRun(999)).toBeNull();
  });

  it("reschedules the nightly alarm at 18:00 UTC after each run", async () => {
    const { conversation, alarms, runs } = createDO();
    // Let the constructor's blockConcurrencyWhile finish
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(alarms).toHaveLength(1);
    alarms.length = 0;

    await conversation.alarm();

    expect(alarms).toHaveLength(1);
    expect(alarms[0] % DAY).toBe(18 * 60 * 60 * 1000);
    expect(alarms[0]).toBeGreaterThan(Date.now());
    // No messages in the fake, so nothing is consolidated
    expect(runs).toEqual([]);
  });
});
