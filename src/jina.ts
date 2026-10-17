const SEARCH_URL = "https://s.jina.ai/";
const READER_URL = "https://r.jina.ai/";

// Bound the text one tool result adds to the agent's context.
const MAX_CHARS = 8_000;
const TIMEOUT_MS = 30_000;

export interface JinaOptions {
  apiKey: string;
  /** Endpoint override (.dev.vars JINA_SEARCH_URL / JINA_READER_URL) */
  endpoint?: string;
  fetchFn?: typeof fetch;
  maxChars?: number;
}

/** Search the web with Jina Search and return the results as text for the model. */
export async function jinaSearch(
  query: string,
  options: JinaOptions,
): Promise<string> {
  const res = await jinaFetch(
    `${baseUrl(options.endpoint || SEARCH_URL)}/?q=${encodeURIComponent(query)}`,
    "application/json",
    options,
  );
  return truncate(formatSearchResults(await res.text()), options.maxChars);
}

/** Fetch one page as markdown with Jina Reader. */
export async function jinaRead(
  url: string,
  options: JinaOptions,
): Promise<string> {
  const res = await jinaFetch(
    `${baseUrl(options.endpoint || READER_URL)}/${httpUrl(url)}`,
    "text/plain",
    options,
  );
  return truncate(await res.text(), options.maxChars);
}

/** The endpoint override may be written with or without the trailing slash */
function baseUrl(endpoint: string): string {
  return endpoint.replace(/\/+$/, "");
}

function httpUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("read_page needs an http(s) URL");
  }
  return parsed.toString();
}

async function jinaFetch(
  target: string,
  accept: string,
  options: JinaOptions,
): Promise<Response> {
  const doFetch = options.fetchFn ?? fetch.bind(globalThis);
  const res = await doFetch(target, {
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      Accept: accept,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`jina ${res.status}: ${detail}`);
  }
  return res;
}

interface SearchResult {
  title?: string;
  url?: string;
  content?: string;
  description?: string;
}

/** Jina Search answers with `{ data: [...] }`. Anything else is returned as-is. */
function formatSearchResults(body: string): string {
  let data: unknown;
  try {
    data = (JSON.parse(body) as { data?: unknown }).data;
  } catch {
    return body;
  }
  if (!Array.isArray(data)) return body;

  const text = (data as SearchResult[])
    .map((result, index) => {
      const heading = `## ${result.title ?? `結果 ${index + 1}`}`;
      const body = result.content ?? result.description ?? "";
      return [heading, result.url ?? "", body].filter((line) => line !== "").join("\n");
    })
    .join("\n\n");
  return text || body;
}

function truncate(text: string, maxChars = MAX_CHARS): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n…(省略)`;
}
