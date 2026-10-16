import type { ConversationDO } from "./conversation";
import type { DedupeDO } from "./dedupe";
import type { GatewayDO } from "./gateway";

export interface Env {
  DISCORD_GATEWAY: DurableObjectNamespace<GatewayDO>;
  DEDUPE: DurableObjectNamespace<DedupeDO>;
  CONVERSATION: DurableObjectNamespace<ConversationDO>;

  DISCORD_BOT_TOKEN: string;
  DISCORD_APPLICATION_ID: string;
  DISCORD_GATEWAY_SECRET: string;
  ADMIN_SECRET: string;

  AI_GATEWAY_API_KEY: string;
  AI_GATEWAY_BASE_URL?: string;
}
