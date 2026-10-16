import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import type { ChannelContext, LoggedMessage } from "./prompt";

/** Who read or wrote a memory. Recorded in memory_log. */
export type MemoryActor = "reply" | "extraction" | "command" | "nightly";

/** A single memory. */
export interface Memory {
  id: string;
  userId: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * The raw log per channel and the memories per user. Logs and memories live in separate tables.
 * Both automatic memory updates (ISSUE-1869) and nightly consolidation (ISSUE-1874) touch
 * logs and memories, so they share one DO to be handled in a single transaction.
 */
export class ConversationDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const sql = ctx.storage.sql;
      sql.exec(
        "CREATE TABLE IF NOT EXISTS messages (" +
          "id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, author_id TEXT NOT NULL," +
          " author_name TEXT NOT NULL, is_bot INTEGER NOT NULL, content TEXT NOT NULL," +
          " created_at INTEGER NOT NULL)",
      );
      sql.exec(
        "CREATE INDEX IF NOT EXISTS messages_channel_created ON messages (channel_id, created_at)",
      );
      // The nightly memory consolidation (ISSUE-1874) writes the summary via setSummary
      sql.exec(
        "CREATE TABLE IF NOT EXISTS summaries (" +
          "channel_id TEXT PRIMARY KEY, content TEXT NOT NULL, updated_at INTEGER NOT NULL)",
      );
      sql.exec(
        "CREATE TABLE IF NOT EXISTS memories (" +
          "id TEXT PRIMARY KEY, user_id TEXT NOT NULL, content TEXT NOT NULL," +
          " created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
      );
      sql.exec(
        "CREATE INDEX IF NOT EXISTS memories_user ON memories (user_id, updated_at)",
      );
      sql.exec(
        "CREATE TABLE IF NOT EXISTS episodes (" +
          "id TEXT PRIMARY KEY, user_id TEXT NOT NULL, channel_id TEXT," +
          " content TEXT NOT NULL, created_at INTEGER NOT NULL)",
      );
      // Ledger of memory reads and writes. Holds before / after JSON for rollback.
      sql.exec(
        "CREATE TABLE IF NOT EXISTS memory_log (" +
          "id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL," +
          " table_name TEXT NOT NULL, record_id TEXT NOT NULL, user_id TEXT NOT NULL," +
          " before TEXT, after TEXT, actor TEXT NOT NULL, created_at INTEGER NOT NULL)",
      );
      // Change reason (added in ISSUE-1869). Added to existing DOs too
      if (
        !sql
          .exec<{ name: string }>("PRAGMA table_info(memory_log)")
          .toArray()
          .some((column) => column.name === "reason")
      ) {
        sql.exec("ALTER TABLE memory_log ADD COLUMN reason TEXT");
      }
    });
  }

  append(message: LoggedMessage): void {
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO messages" +
        " (id, channel_id, author_id, author_name, is_bot, content, created_at)" +
        " VALUES (?, ?, ?, ?, ?, ?, ?)",
      message.id,
      message.channelId,
      message.authorId,
      message.authorName,
      message.isBot ? 1 : 0,
      message.content,
      message.createdAt,
    );
  }

  context(channelId: string, limit: number): ChannelContext {
    const rows = this.ctx.storage.sql
      .exec<{
        id: string;
        channel_id: string;
        author_id: string;
        author_name: string;
        is_bot: number;
        content: string;
        created_at: number;
      }>(
        "SELECT * FROM messages WHERE channel_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
        channelId,
        limit,
      )
      .toArray();

    const summary = this.ctx.storage.sql
      .exec<{ content: string }>(
        "SELECT content FROM summaries WHERE channel_id = ?",
        channelId,
      )
      .toArray()[0];

    return {
      summary: summary?.content ?? null,
      messages: rows.reverse().map((row) => ({
        id: row.id,
        channelId: row.channel_id,
        authorId: row.author_id,
        authorName: row.author_name,
        isBot: Number(row.is_bot) === 1,
        content: row.content,
        createdAt: Number(row.created_at),
      })),
    };
  }

  setSummary(channelId: string, content: string): void {
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO summaries (channel_id, content, updated_at) VALUES (?, ?, ?)",
      channelId,
      content,
      Date.now(),
    );
  }

  /** For the speaker profile injected into prompts. Reads are also recorded in memory_log. */
  async memories(
    userId: string,
    limit: number,
    actor: MemoryActor,
    reason?: string,
  ): Promise<Memory[]> {
    const rows = this.selectMemories(userId, limit);
    this.logMemory({
      action: "read",
      recordId: rows.map((row) => row.id).join(",") || "(none)",
      userId,
      before: null,
      after: null,
      actor,
      reason,
    });
    return rows;
  }

  async appendMemory(
    userId: string,
    content: string,
    actor: MemoryActor,
    reason?: string,
  ): Promise<Memory> {
    const now = Date.now();
    const memory: Memory = {
      id: crypto.randomUUID(),
      userId,
      content,
      createdAt: now,
      updatedAt: now,
    };
    this.ctx.storage.sql.exec(
      "INSERT INTO memories (id, user_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      memory.id,
      memory.userId,
      memory.content,
      memory.createdAt,
      memory.updatedAt,
    );
    this.logMemory({
      action: "add",
      recordId: memory.id,
      userId,
      before: null,
      after: JSON.stringify(memory),
      actor,
      reason,
    });
    return memory;
  }

  /** Returns null when the id does not exist. */
  async updateMemory(
    id: string,
    content: string,
    actor: MemoryActor,
    reason?: string,
  ): Promise<Memory | null> {
    const before = this.findMemory(id);
    if (!before) return null;
    const after: Memory = { ...before, content, updatedAt: Date.now() };
    this.ctx.storage.sql.exec(
      "UPDATE memories SET content = ?, updated_at = ? WHERE id = ?",
      after.content,
      after.updatedAt,
      id,
    );
    this.logMemory({
      action: "update",
      recordId: id,
      userId: before.userId,
      before: JSON.stringify(before),
      after: JSON.stringify(after),
      actor,
      reason,
    });
    return after;
  }

  /** Returns false when the id does not exist. */
  async deleteMemory(
    id: string,
    actor: MemoryActor,
    reason?: string,
  ): Promise<boolean> {
    const before = this.findMemory(id);
    if (!before) return false;
    this.ctx.storage.sql.exec("DELETE FROM memories WHERE id = ?", id);
    this.logMemory({
      action: "delete",
      recordId: id,
      userId: before.userId,
      before: JSON.stringify(before),
      after: null,
      actor,
      reason,
    });
    return true;
  }

  private findMemory(id: string): Memory | null {
    const row = this.ctx.storage.sql
      .exec<{
        id: string;
        user_id: string;
        content: string;
        created_at: number;
        updated_at: number;
      }>("SELECT * FROM memories WHERE id = ?", id)
      .toArray()[0];
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      content: row.content,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  private selectMemories(userId: string, limit: number): Memory[] {
    return this.ctx.storage.sql
      .exec<{
        id: string;
        user_id: string;
        content: string;
        created_at: number;
        updated_at: number;
      }>(
        "SELECT * FROM memories WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?",
        userId,
        limit,
      )
      .toArray()
      .map((row) => ({
        id: row.id,
        userId: row.user_id,
        content: row.content,
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
      }));
  }

  private logMemory(change: {
    action: string;
    recordId: string;
    userId: string;
    before: string | null;
    after: string | null;
    actor: MemoryActor;
    reason?: string;
  }): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO memory_log" +
        " (action, table_name, record_id, user_id, before, after, actor, reason, created_at)" +
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      change.action,
      "memories",
      change.recordId,
      change.userId,
      change.before,
      change.after,
      change.actor,
      change.reason ?? null,
      Date.now(),
    );
  }
}
