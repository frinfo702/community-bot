import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import type { ChannelContext, LoggedMessage } from "./prompt";

/** 記憶を読み書きした主体。memory_log に残す。 */
export type MemoryActor = "reply" | "extraction" | "command" | "nightly";

/** bot の発言についた反応の種類。夜間のスタイル改訂（ISSUE-1867）が読む。 */
export type SignalKind = "reaction" | "correction";

/** 1件の反応シグナル。message_id は反応された bot の発言。 */
export interface Signal {
  id: number;
  messageId: string;
  userId: string;
  kind: SignalKind;
  /** リアクションは絵文字、訂正は本文 */
  value: string;
  createdAt: number;
}

/** 1回のスタイル改訂の記録。applied = 1 の最新行が有効なオーバーライド。 */
export interface StyleRevision {
  before: string;
  after: string;
  deviationBefore: number;
  deviationAfter: number;
  applied: boolean;
  createdAt: number;
}

/** 1件の記憶。 */
export interface Memory {
  id: string;
  userId: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * チャンネル単位の生ログと、ユーザーごとの記憶。ログと記憶はテーブルを分けて持つ。
 * 記憶の自動更新（ISSUE-1869）と夜間整理（ISSUE-1874）はどちらもログと記憶の両方を
 * 触るので、同一 DO に置いて1トランザクションで扱えるようにしている。
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
      // 要約は夜間の記憶整理（ISSUE-1874）が setSummary で書く
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
      // 記憶の読み書きの台帳。rollback 用に before / after の JSON を持つ。
      sql.exec(
        "CREATE TABLE IF NOT EXISTS memory_log (" +
          "id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL," +
          " table_name TEXT NOT NULL, record_id TEXT NOT NULL, user_id TEXT NOT NULL," +
          " before TEXT, after TEXT, actor TEXT NOT NULL, created_at INTEGER NOT NULL)",
      );
      sql.exec(
        "CREATE TABLE IF NOT EXISTS signals (" +
          "id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT NOT NULL," +
          " user_id TEXT NOT NULL, kind TEXT NOT NULL, value TEXT NOT NULL," +
          " created_at INTEGER NOT NULL)",
      );
      // 再接続時の replay などで同じ反応が再送されても二重に数えない
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

  /** 発言者に注入するプロフィール用。読み出しも memory_log に残す。 */
  memories(userId: string, limit: number, actor: MemoryActor): Memory[] {
    const rows = this.selectMemories(userId, limit);
    this.logMemory({
      action: "read",
      recordId: rows.map((row) => row.id).join(",") || "(none)",
      userId,
      before: null,
      after: null,
      actor,
    });
    return rows;
  }

  appendMemory(userId: string, content: string, actor: MemoryActor): Memory {
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
    });
    return memory;
  }

  /** 存在しない id なら null を返す。 */
  updateMemory(id: string, content: string, actor: MemoryActor): Memory | null {
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
    });
    return after;
  }

  /** 存在しない id なら false を返す。 */
  deleteMemory(id: string, actor: MemoryActor): boolean {
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
    });
    return true;
  }

  /** bot の発言へのリアクションだけ記録する。bot 自身の操作や対象外のメッセージでは false。 */
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

  /** bot の発言への訂正。判定は呼び出し側（decideCorrection）が済ませている。 */
  recordCorrection(messageId: string, userId: string, content: string): void {
    this.insertSignal(messageId, userId, "correction", content);
  }

  /** 期間内のシグナルを古い順に返す（LLM に渡す用）。 */
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

  /** 有効なスタイルオーバーライド。無ければ null（persona.md の style を使う）。 */
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
  }): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO memory_log" +
        " (action, table_name, record_id, user_id, before, after, actor, created_at)" +
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      change.action,
      "memories",
      change.recordId,
      change.userId,
      change.before,
      change.after,
      change.actor,
      Date.now(),
    );
  }
}
