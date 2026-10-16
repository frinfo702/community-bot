import {
  DiscordGatewayDO,
  type GatewayCredentials,
} from "discord-gateway-cloudflare-do";
import type { Env } from "./env";

/**
 * discord-gateway-cloudflare-do's connect() is hidden by the reserved name on DO stubs
 * (connect for socket connections) and cannot be called through a stub, so it is exposed
 * over RPC again as start().
 * Upstream: https://github.com/dcartertwo/discord-gateway-cloudflare-do/issues/3
 * Remove this wrapper and comment once a renamed method ships upstream.
 */
export class GatewayDO extends DiscordGatewayDO<Env> {
  start(
    credentials: GatewayCredentials,
  ): Promise<{ status: "connecting" } | { error: string }> {
    return this.connect(credentials);
  }
}
