import {
  DiscordGatewayDO,
  type GatewayCredentials,
} from "discord-gateway-cloudflare-do";
import type { Env } from "./env";

/**
 * discord-gateway-cloudflare-do's connect() is hidden by the reserved name on DO stubs
 * (connect for socket connections) and cannot be called through a stub, so it is exposed
 * over RPC again as start().
 */
export class GatewayDO extends DiscordGatewayDO<Env> {
  start(
    credentials: GatewayCredentials,
  ): Promise<{ status: "connecting" } | { error: string }> {
    return this.connect(credentials);
  }
}
