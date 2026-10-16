const DEFAULT_BASE_URL = "https://ai-gateway.vercel.sh/v1";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
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

/** Vercel AI Gateway（OpenAI 互換）で1ターン分の返答を生成する。 */
export async function chat(options: ChatOptions): Promise<string> {
  return (await chatWithUsage(options)).text;
}

/** Same call as chat(), with usage for cost logging. */
export async function chatWithUsage(options: ChatOptions): Promise<ChatResult> {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
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
