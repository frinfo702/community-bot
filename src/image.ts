const DEFAULT_BASE_URL = "https://ai-gateway.vercel.sh/v1";
const DEFAULT_TIMEOUT_MS = 60_000;

export interface ImageOptions {
  apiKey: string;
  model: string;
  prompt: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export interface GeneratedImage {
  data: Uint8Array;
  contentType: string;
  /** usage returned by the image API (a clue to cost; it may be absent) */
  usage?: unknown;
}

/** Generate one image via Vercel AI Gateway (OpenAI compatible). */
export async function generateImage(
  options: ImageOptions,
): Promise<GeneratedImage> {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const doFetch = options.fetchFn ?? fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const res = await doFetch(`${baseUrl}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: options.model, prompt: options.prompt, n: 1 }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`image gateway ${res.status}: ${detail}`);
  }

  const data = (await res.json()) as {
    data?: Array<{ b64_json?: string; url?: string }>;
    usage?: unknown;
  };
  const first = data.data?.[0];
  if (first?.b64_json) {
    return {
      data: base64ToBytes(first.b64_json),
      contentType: "image/png",
      usage: data.usage,
    };
  }
  if (first?.url) {
    // Some models return a URL instead of base64
    const imageRes = await doFetch(first.url, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!imageRes.ok) {
      throw new Error(`image download ${imageRes.status}`);
    }
    return {
      data: new Uint8Array(await imageRes.arrayBuffer()),
      contentType: imageRes.headers.get("content-type") ?? "image/png",
      usage: data.usage,
    };
  }
  throw new Error("image gateway returned no image");
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
