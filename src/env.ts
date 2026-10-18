import type { TaskAgent } from "./agent";
import type { ConversationDO } from "./conversation";
import type { DedupeDO } from "./dedupe";
import type { GatewayDO } from "./gateway";
import type { ModelEnv } from "./models";
import type { SandboxContainer } from "./sandbox";

export interface Env extends ModelEnv {
  DISCORD_GATEWAY: DurableObjectNamespace<GatewayDO>;
  DEDUPE: DurableObjectNamespace<DedupeDO>;
  CONVERSATION: DurableObjectNamespace<ConversationDO>;
  SANDBOX: DurableObjectNamespace<SandboxContainer>;
  TASK_AGENT: DurableObjectNamespace<TaskAgent>;

  DISCORD_BOT_TOKEN: string;
  DISCORD_APPLICATION_ID: string;
  /** Ed25519 public key of the app; verifies the signature on every interaction. */
  DISCORD_PUBLIC_KEY: string;
  DISCORD_GATEWAY_SECRET: string;
  ADMIN_SECRET: string;

  AI_GATEWAY_API_KEY: string;
  AI_GATEWAY_BASE_URL?: string;

  JINA_API_KEY: string;
  JINA_SEARCH_URL?: string;
  JINA_READER_URL?: string;
}
