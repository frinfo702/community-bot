import { chatWithUsage } from "./llm";

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/;

// Punctuation that ends the sentence rather than the URL.
const TRAILING_PUNCTUATION = /[.,;:!?、。」』）)\]】]+$/;

const SUMMARY_INSTRUCTIONS =
  "Summarize the web page the bot fetched. Reply in the language of the page, in three sentences or fewer.";

export interface TaskDeps {
  /** Fetch the page body inside the sandbox. */
  fetchText: (url: string) => Promise<string>;
  /** Summarize the page body. */
  summarize: (
    url: string,
    page: string,
  ) => Promise<{ summary: string; usage?: unknown }>;
}

export interface TaskRun {
  url: string;
  summary: string;
  /** Time spent fetching the page in the sandbox (cost hint). */
  sandboxMs: number;
  /** Chat model usage of the summary (cost hint). */
  usage?: unknown;
}

export interface SummaryOptions {
  apiKey: string;
  model: string;
  url: string;
  page: string;
  baseUrl?: string;
}

/**
 * The one canned task: fetch the http(s) URL in the message and summarize it.
 * Returns null when the message has no usable URL or when the task failed,
 * so the caller can fall back to the normal text reply.
 */
export async function executeTask(
  content: string,
  deps: TaskDeps,
): Promise<TaskRun | null> {
  const url = extractUrl(content);
  if (!url) return null;

  try {
    const startedAt = Date.now();
    const page = await deps.fetchText(url);
    const sandboxMs = Date.now() - startedAt;
    const { summary, usage } = await deps.summarize(url, page);
    return { url, summary, sandboxMs, usage };
  } catch (err) {
    console.error("task execution failed", url, err);
    return null;
  }
}

/** The first fetchable http(s) URL in the message, or null. */
export function extractUrl(content: string): string | null {
  const match = URL_PATTERN.exec(content);
  if (!match) return null;

  const candidate = match[0].replace(TRAILING_PUNCTUATION, "");
  try {
    // The URL comes from a Discord message, so keep it away from local addresses.
    return isPublicHttpUrl(new URL(candidate)) ? candidate : null;
  } catch {
    return null;
  }
}

function isPublicHttpUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (/^(::1$|::$)/.test(host)) return false;
  if (/^(127\.|0\.|10\.|192\.168\.|169\.254\.|fe80:|f[cd][0-9a-f]{2}:)/.test(host)) {
    return false;
  }
  return !/^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

/** Summarize a fetched page with the chat model. */
export async function summarizePage(
  options: SummaryOptions,
): Promise<{ summary: string; usage?: unknown }> {
  const { text, usage } = await chatWithUsage({
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    model: options.model,
    messages: [
      { role: "system", content: SUMMARY_INSTRUCTIONS },
      { role: "user", content: `URL: ${options.url}\n\n${options.page}` },
    ],
    timeoutMs: 60_000,
  });
  return { summary: text, usage };
}
