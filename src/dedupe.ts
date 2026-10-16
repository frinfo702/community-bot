import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 受信済みメッセージIDの台帳。Gateway のレジュームでイベントが再送されても
 * 同じメッセージに二度返信しないための最小の仕組み。
 */
export class DedupeDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS seen (id TEXT PRIMARY KEY, ts INTEGER NOT NULL)",
      );
    });
  }

  /** 既に見ていたら true を返す。 */
  seen(id: string): boolean {
    const now = Date.now();
    const sql = this.ctx.storage.sql;
    sql.exec("DELETE FROM seen WHERE ts < ?", now - RETENTION_MS);
    const row = sql.exec("SELECT COUNT(*) AS n FROM seen WHERE id = ?", id).one();
    sql.exec("INSERT OR REPLACE INTO seen (id, ts) VALUES (?, ?)", id, now);
    return Number(row.n) > 0;
  }
}
