import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import type { ChannelContext, LoggedMessage } from "./prompt";

/**
 * チャンネル単位の生ログ。記憶（memories / episodes 相当）は ISSUE-1872 で別テーブルに
 * 置く前提で、この DO にはログと要約だけを持たせる。
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
}
