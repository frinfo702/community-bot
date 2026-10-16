import {
  DiscordGatewayDO,
  type GatewayCredentials,
} from "discord-gateway-cloudflare-do";
import type { Env } from "./env";

/**
 * discord-gateway-cloudflare-do の connect() は DO スタブの予約名（ソケット接続の
 * connect）に隠れてスタブ経由で呼べないため、start() として RPC に露出し直す。
 * Upstream: https://github.com/dcartertwo/discord-gateway-cloudflare-do/issues/3
 * 上流でメソッド名の変更がリリースされたら、このラップとコメントを削除する。
 */
export class GatewayDO extends DiscordGatewayDO<Env> {
  start(
    credentials: GatewayCredentials,
  ): Promise<{ status: "connecting" } | { error: string }> {
    return this.connect(credentials);
  }
}
