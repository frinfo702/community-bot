import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import { jevFor } from "./jev";
import { chatFor } from "./llm";
import {
  nextNightlyAt,
  runNightlyConsolidation,
  type NightlyRun,
  type NightlyRunRecord,
} from "./nightly";
import type { ChannelContext, LoggedMessage } from "./prompt";
import type { CustomEmoji } from "./stamp";

/** Who read or wrote a memory. Recorded in memory_log. */
export type MemoryActor = "reply" | "extraction" | "command" | "nightly";

/** Kind of reaction attached to a bot message. Read by the nightly style revision (ISSUE-1867). */
export type SignalKind = "reaction" | "correction";

/** A single reaction signal. message_id is the bot message that was reacted to. */
export interface Signal {
  id: number;
  messageId: string;
  userId: string;
  kind: SignalKind;
  /** Emoji for reactions, body text for corrections */
  value: string;
  createdAt: number;
}

/** Record of one style revision. The newest applied = 1 row is the active override. */
export interface StyleRevision {
  before: string;
  after: string;
  deviationBefore: number;
  deviationAfter: number;
  applied: boolean;
  createdAt: number;
}

/** A single memory. */
export interface Memory {
  id: string;
  userId: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

/** Result of rolling one nightly run back. */
export interface MemoryRollbackResult {
  runId: number;
  day: string;
  /** Changes undone / skipped because the record had moved on since the run. */
  reversed: number;
  skipped: number;
  alreadyRolledBack: boolean;
}

/** One memory_log row needed to undo a change. Object literal so it satisfies the SQL row constraint. */
type MemoryLogRow = {
  id: number;
  action: string;
  record_id: string;
  user_id: string;
  before: string | null;
  after: string | null;
};

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
      // Channel summaries for the reply context (written by setSummary)
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
      sql.exec(
        "CREATE TABLE IF NOT EXISTS signals (" +
          "id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT NOT NULL," +
          " user_id TEXT NOT NULL, kind TEXT NOT NULL, value TEXT NOT NULL," +
          " created_at INTEGER NOT NULL)",
      );
      // Reconnect replays can resend the same reaction; do not count it twice
      sql.exec(
        "CREATE UNIQUE INDEX IF NOT EXISTS signals_dedupe" +
          " ON signals (message_id, user_id, kind, value)",
      );
      sql.exec(
        "CREATE TABLE IF NOT EXISTS style_revisions (" +
          "id INTEGER PRIMARY KEY AUTOINCREMENT, before TEXT NOT NULL, after TEXT NOT NULL," +
          " deviation_before REAL NOT NULL, deviation_after REAL NOT NULL," +
          " applied INTEGER NOT NULL, created_at INTEGER NOT NULL)",
      );
      // Emoji rankings per reaction category (stamp). version invalidates rows when the
      // catalog or the guild's custom emoji set changes (src/stamp.ts)
      sql.exec(
        "CREATE TABLE IF NOT EXISTS stamp_emoji_cache (" +
          "scope TEXT NOT NULL, category TEXT NOT NULL, version TEXT NOT NULL," +
          " ranking TEXT NOT NULL, updated_at INTEGER NOT NULL," +
          " PRIMARY KEY (scope, category))",
      );
      // The guild's custom emoji list, reused for a while so it is not fetched per message
      sql.exec(
        "CREATE TABLE IF NOT EXISTS guild_emojis (" +
          "scope TEXT PRIMARY KEY, list TEXT NOT NULL, fetched_at INTEGER NOT NULL)",
      );
      // One row per nightly consolidation (ISSUE-1874): the day's diary and the change summary
      sql.exec(
        "CREATE TABLE IF NOT EXISTS nightly_runs (" +
          "id INTEGER PRIMARY KEY AUTOINCREMENT, day TEXT NOT NULL, diary TEXT NOT NULL," +
          " summary TEXT NOT NULL, started_at INTEGER NOT NULL," +
          " finished_at INTEGER NOT NULL, rolled_back INTEGER NOT NULL DEFAULT 0)",
      );
      // Always keep the nightly alarm scheduled, even after a deploy or an alarm error
      if ((await ctx.storage.getAlarm()) === null) {
        await ctx.storage.setAlarm(nextNightlyAt(Date.now()));
      }
    });
  }

  /**
   * Nightly memory consolidation (ISSUE-1874), scheduled by alarm() at 03:00 JST.
   * Independent of the Cron Trigger, which runs the style revision. Errors are
   * logged and swallowed so the next night is always scheduled.
   */
  async alarm(): Promise<void> {
    try {
      await runNightlyConsolidation({
        store: this,
        jev: jevFor(this.env),
        generate: chatFor(this.env),
        record: (run) => this.recordNightlyRun(run),
        log: (message) => console.log("nightly", message),
        botId: this.env.DISCORD_APPLICATION_ID,
      });
    } catch (err) {
      console.error("nightly consolidation failed", err);
    } finally {
      await this.ctx.storage.setAlarm(nextNightlyAt(Date.now()));
    }
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

  /**
   * Used by the /memory command. Never deletes another user's memory
   * (ownership is checked here), and deletes go through deleteMemory so
   * memory_log records them with the given actor.
   */
  async forgetMemory(
    id: string,
    userId: string,
    actor: MemoryActor,
  ): Promise<"deleted" | "not_found" | "not_owner"> {
    const before = this.findMemory(id);
    if (!before) return "not_found";
    if (before.userId !== userId) return "not_owner";
    await this.deleteMemory(id, actor);
    return "deleted";
  }

  /** Deletes all memories of the caller and returns the count; logs each delete. */
  async forgetAllMemories(userId: string, actor: MemoryActor): Promise<number> {
    const ids = this.ctx.storage.sql
      .exec<{ id: string }>("SELECT id FROM memories WHERE user_id = ?", userId)
      .toArray()
      .map((row) => row.id);
    for (const id of ids) {
      await this.deleteMemory(id, actor);
    }
    return ids.length;
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

  /** Record only reactions on bot messages. False for the bot's own actions or unrelated messages. */
  recordReaction(
    messageId: string,
    userId: string,
    emoji: string,
    botId: string,
  ): boolean {
    if (userId === botId) return false;
    const row = this.ctx.storage.sql
      .exec<{ author_id: string }>(
        "SELECT author_id FROM messages WHERE id = ?",
        messageId,
      )
      .toArray()[0];
    if (row?.author_id !== botId) return false;
    this.insertSignal(messageId, userId, "reaction", emoji);
    return true;
  }

  /** A correction of a bot message. The caller (decideCorrection) already made the call. */
  recordCorrection(messageId: string, userId: string, content: string): void {
    this.insertSignal(messageId, userId, "correction", content);
  }

  /** Signals in the window, oldest first (for the LLM). */
  recentSignals(since: number, limit: number): Signal[] {
    return this.ctx.storage.sql
      .exec<{
        id: number;
        message_id: string;
        user_id: string;
        kind: SignalKind;
        value: string;
        created_at: number;
      }>(
        "SELECT * FROM signals WHERE created_at >= ? ORDER BY created_at DESC, id DESC LIMIT ?",
        since,
        limit,
      )
      .toArray()
      .reverse()
      .map((row) => ({
        id: Number(row.id),
        messageId: row.message_id,
        userId: row.user_id,
        kind: row.kind,
        value: row.value,
        createdAt: Number(row.created_at),
      }));
  }

  /** Active style override. Null means use the style from persona.md. */
  activeStyle(): string | null {
    const row = this.ctx.storage.sql
      .exec<{ after: string }>(
        "SELECT after FROM style_revisions WHERE applied = 1 ORDER BY id DESC LIMIT 1",
      )
      .toArray()[0];
    return row?.after ?? null;
  }

  recordStyleRevision(revision: StyleRevision): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO style_revisions" +
        " (before, after, deviation_before, deviation_after, applied, created_at)" +
        " VALUES (?, ?, ?, ?, ?, ?)",
      revision.before,
      revision.after,
      revision.deviationBefore,
      revision.deviationAfter,
      revision.applied ? 1 : 0,
      revision.createdAt,
    );
  }

  /**
   * Cached emoji ranking (best first) for one reaction category. Null when missing
   * or built from other emoji sets, so the caller rebuilds it with Jev.
   */
  async stampRanking(
    scope: string,
    category: string,
    version: string,
  ): Promise<string[] | null> {
    const row = this.ctx.storage.sql
      .exec<{ ranking: string }>(
        "SELECT ranking FROM stamp_emoji_cache" +
          " WHERE scope = ? AND category = ? AND version = ?",
        scope,
        category,
        version,
      )
      .toArray()[0];
    return row ? (JSON.parse(row.ranking) as string[]) : null;
  }

  async saveStampRanking(
    scope: string,
    category: string,
    version: string,
    ranking: string[],
  ): Promise<void> {
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO stamp_emoji_cache" +
        " (scope, category, version, ranking, updated_at) VALUES (?, ?, ?, ?, ?)",
      scope,
      category,
      version,
      JSON.stringify(ranking),
      Date.now(),
    );
  }

  /** The guild's custom emoji list while it is still fresh; null when missing or stale. */
  async guildEmojis(
    scope: string,
    freshWithinMs: number,
  ): Promise<CustomEmoji[] | null> {
    const row = this.ctx.storage.sql
      .exec<{ list: string; fetched_at: number }>(
        "SELECT list, fetched_at FROM guild_emojis WHERE scope = ?",
        scope,
      )
      .toArray()[0];
    if (!row || Date.now() - Number(row.fetched_at) > freshWithinMs) return null;
    return JSON.parse(row.list) as CustomEmoji[];
  }

  async saveGuildEmojis(scope: string, emojis: CustomEmoji[]): Promise<void> {
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO guild_emojis (scope, list, fetched_at) VALUES (?, ?, ?)",
      scope,
      JSON.stringify(emojis),
      Date.now(),
    );
  }

  /** Non-bot messages in [since, until), oldest first, for the nightly run. */
  async messagesSince(since: number, until: number): Promise<LoggedMessage[]> {
    return this.ctx.storage.sql
      .exec<{
        id: string;
        channel_id: string;
        author_id: string;
        author_name: string;
        is_bot: number;
        content: string;
        created_at: number;
      }>(
        "SELECT * FROM messages WHERE is_bot = 0 AND created_at >= ? AND created_at < ?" +
          " ORDER BY created_at ASC, id ASC",
        since,
        until,
      )
      .toArray()
      .map((row) => ({
        id: row.id,
        channelId: row.channel_id,
        authorId: row.author_id,
        authorName: row.author_name,
        isBot: Number(row.is_bot) === 1,
        content: row.content,
        createdAt: Number(row.created_at),
      }));
  }

  /** Memories not updated since `before`, oldest first. Used by the nightly decay pass. */
  async staleMemories(before: number, limit: number): Promise<Memory[]> {
    return this.ctx.storage.sql
      .exec<{
        id: string;
        user_id: string;
        content: string;
        created_at: number;
        updated_at: number;
      }>(
        "SELECT * FROM memories WHERE updated_at < ? ORDER BY updated_at ASC LIMIT ?",
        before,
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

  /** Stores one nightly run and returns it with the assigned id. */
  async recordNightlyRun(run: NightlyRun): Promise<NightlyRunRecord> {
    this.ctx.storage.sql.exec(
      "INSERT INTO nightly_runs (day, diary, summary, started_at, finished_at)" +
        " VALUES (?, ?, ?, ?, ?)",
      run.day,
      run.diary,
      JSON.stringify(run.summary),
      run.startedAt,
      run.finishedAt,
    );
    const id = Number(
      this.ctx.storage.sql
        .exec<{ id: number }>("SELECT last_insert_rowid() AS id")
        .toArray()[0].id,
    );
    return { id, ...run, rolledBack: false };
  }

  /**
   * Rolls back the memory changes of one nightly run, newest change first, by
   * replaying the before / after in memory_log. A record that changed again after
   * the run is skipped, so later extraction or commands are not clobbered. The
   * undo itself is logged with action "rollback" and actor "nightly".
   * Null when the run does not exist (runId omitted = the latest run).
   */
  async rollbackNightlyRun(runId?: number): Promise<MemoryRollbackResult | null> {
    const run = (
      runId === undefined
        ? this.ctx.storage.sql.exec<{
            id: number;
            day: string;
            started_at: number;
            finished_at: number;
            rolled_back: number;
          }>("SELECT * FROM nightly_runs ORDER BY id DESC LIMIT 1")
        : this.ctx.storage.sql.exec<{
            id: number;
            day: string;
            started_at: number;
            finished_at: number;
            rolled_back: number;
          }>("SELECT * FROM nightly_runs WHERE id = ?", runId)
    )
      .toArray()[0];
    if (!run) return null;
    if (Number(run.rolled_back) === 1) {
      return {
        runId: Number(run.id),
        day: run.day,
        reversed: 0,
        skipped: 0,
        alreadyRolledBack: true,
      };
    }

    const logged = this.ctx.storage.sql
      .exec<MemoryLogRow>(
        "SELECT * FROM memory_log WHERE actor = 'nightly'" +
          " AND action IN ('add', 'update', 'delete')" +
          " AND created_at >= ? AND created_at <= ? ORDER BY id DESC",
        run.started_at,
        run.finished_at,
      )
      .toArray();

    let reversed = 0;
    let skipped = 0;
    for (const row of logged) {
      if (this.undoMemoryChange(row, Number(run.id))) reversed++;
      else skipped++;
    }
    this.ctx.storage.sql.exec(
      "UPDATE nightly_runs SET rolled_back = 1 WHERE id = ?",
      run.id,
    );
    return {
      runId: Number(run.id),
      day: run.day,
      reversed,
      skipped,
      alreadyRolledBack: false,
    };
  }

  /** Undoes one logged change. False when the current row is not the `after` state of the log. */
  private undoMemoryChange(row: MemoryLogRow, runId: number): boolean {
    const before = row.before ? (JSON.parse(row.before) as Memory) : null;
    const after = row.after ? (JSON.parse(row.after) as Memory) : null;
    const current = this.findMemory(row.record_id);
    const reason = `ロールバック: run ${runId} の ${row.action}`;

    if (row.action === "add") {
      // The record changed again after the run; its newer content wins
      if (!current || current.content !== after?.content) return false;
      this.ctx.storage.sql.exec("DELETE FROM memories WHERE id = ?", row.record_id);
      this.logMemory({
        action: "rollback",
        recordId: row.record_id,
        userId: row.user_id,
        before: JSON.stringify(current),
        after: null,
        actor: "nightly",
        reason,
      });
      return true;
    }

    if (row.action === "update") {
      if (!before || !current || current.content !== after?.content) return false;
      this.ctx.storage.sql.exec(
        "UPDATE memories SET content = ?, updated_at = ? WHERE id = ?",
        before.content,
        before.updatedAt,
        row.record_id,
      );
      this.logMemory({
        action: "rollback",
        recordId: row.record_id,
        userId: row.user_id,
        before: JSON.stringify(current),
        after: JSON.stringify(before),
        actor: "nightly",
        reason,
      });
      return true;
    }

    // delete: put the removed record back
    if (!before || current) return false;
    this.ctx.storage.sql.exec(
      "INSERT INTO memories (id, user_id, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      before.id,
      before.userId,
      before.content,
      before.createdAt,
      before.updatedAt,
    );
    this.logMemory({
      action: "rollback",
      recordId: row.record_id,
      userId: row.user_id,
      before: null,
      after: JSON.stringify(before),
      actor: "nightly",
      reason,
    });
    return true;
  }

  private insertSignal(
    messageId: string,
    userId: string,
    kind: SignalKind,
    value: string,
  ): void {
    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO signals (message_id, user_id, kind, value, created_at)" +
        " VALUES (?, ?, ?, ?, ?)",
      messageId,
      userId,
      kind,
      value,
      Date.now(),
    );
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
