import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Ledger of received message IDs. The minimal mechanism to avoid replying to the same
 * message twice when Gateway resume re-sends events.
 */
export class DedupeDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(
        "CREATE TABLE IF NOT EXISTS seen (id TEXT PRIMARY KEY, ts INTEGER NOT NULL)",
      );
      // The retention delete runs on every message; without this it scans the whole ledger
      ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS seen_ts ON seen (ts)");
    });
  }

  /** Returns true when it has already been seen. */
  seen(id: string): boolean {
    const now = Date.now();
    const sql = this.ctx.storage.sql;
    sql.exec("DELETE FROM seen WHERE ts < ?", now - RETENTION_MS);
    const row = sql.exec("SELECT COUNT(*) AS n FROM seen WHERE id = ?", id).one();
    sql.exec("INSERT OR REPLACE INTO seen (id, ts) VALUES (?, ?)", id, now);
    return Number(row.n) > 0;
  }
}
