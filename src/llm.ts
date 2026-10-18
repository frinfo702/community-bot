import { modelIds, type ModelEnv } from "./models";

const DEFAULT_BASE_URL = "https://ai-gateway.vercel.sh/v1";

/** OpenAI-compatible content parts, so one message can carry text and images. */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

export interface ChatOptions {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export interface ChatResult {
  text: string;
  /** usage reported by AI Gateway (cost hint, not always present) */
  usage?: unknown;
}

export interface GatewayEnv extends ModelEnv {
  AI_GATEWAY_API_KEY: string;
  AI_GATEWAY_BASE_URL?: string;
}

/**
 * Bind the gateway key, the base URL and the chat model from the environment
 * (.dev.vars overrides included), so callers pass only the messages. Callers on
 * a tight deadline (the task acknowledgment) can shorten the timeout.
 */
export function chatFor(
  env: GatewayEnv,
  timeoutMs?: number,
): (messages: ChatMessage[]) => Promise<string> {
  const model = modelIds(env).chat;
  return (messages) =>
    chat({
      apiKey: env.AI_GATEWAY_API_KEY,
      baseUrl: env.AI_GATEWAY_BASE_URL,
      model,
      messages,
      timeoutMs,
    });
}

/** Generate one turn of a reply via Vercel AI Gateway (OpenAI compatible). */
export async function chat(options: ChatOptions): Promise<string> {
  return (await chatWithUsage(options)).text;
}

/** Same call as chat(), with usage for cost logging. */
export async function chatWithUsage(options: ChatOptions): Promise<ChatResult> {
  // An empty value means "not set", so a blank .dev.vars line falls back
  const baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
  const doFetch = options.fetchFn ?? fetch.bind(globalThis);
  const res = await doFetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
    }),
    signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
  });

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`ai gateway ${res.status}: ${detail}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: unknown;
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error("ai gateway returned an empty completion");
  }
  return { text, usage: data.usage };
}
