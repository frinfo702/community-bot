import type { GatewayEnv } from "./llm";
import { modelIds } from "./models";

/**
 * AI Gateway's TypeSafe-compatible API, next to the OpenAI-compatible /v1 one.
 * It is not derived from AI_GATEWAY_BASE_URL, which only moves the chat base.
 */
const DEFAULT_BASE_URL = "https://ai-gateway.vercel.sh/typesafe";
const DEFAULT_TIMEOUT_MS = 10_000;

export type JevState = string | Record<string, unknown> | unknown[];

export interface ChoiceQuestion<C extends string> {
  instructions: string;
  /** Decision criteria per choice */
  criteria: Record<C, string>;
}

export interface BooleanQuestion {
  instructions: string;
  criteria?: { true: string; false: string };
}

export interface ScoreQuestion {
  instructions: string;
  /** Each step of the scale (ascending order) */
  criteria: string[];
}

export interface ChoiceAnswer<C extends string> {
  choice: C;
  confidence?: number;
  probabilities?: Partial<Record<C, number>>;
}

export interface BooleanAnswer {
  /** Probability of yes (0–1). Deciding the threshold is left to the caller */
  probability: number;
}

export interface ScoreAnswer {
  score: number;
  confidence?: number;
}

/** Failures are distinguished between timeout (deadline exceeded) and unavailable (connection or response shape problems). */
export type JevResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: "timeout" | "unavailable"; detail?: string };

export interface JevClientOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

/** A JevClient wired with the gateway key and the decision model from the environment. */
export function jevFor(env: GatewayEnv): JevClient {
  return new JevClient({
    apiKey: env.AI_GATEWAY_API_KEY,
    model: modelIds(env).decide,
  });
}

/**
 * A thin client for TypeSafe Jev (the decision model) through AI Gateway, so
 * decisions share the chat calls' key, cost and logs. It generates no text and
 * only receives typed answers for choice / boolean / score.
 */
export class JevClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

  constructor(options: JevClientOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    // An empty value means "not set", so a blank .dev.vars line falls back
    this.baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    // Without bind, workerd throws Illegal invocation (calling global fetch as a method changes this)
    this.fetchFn = options.fetchFn ?? fetch.bind(globalThis);
  }

  choice<C extends string>(
    state: JevState,
    question: ChoiceQuestion<C>,
  ): Promise<JevResult<ChoiceAnswer<C>>> {
    return this.ask(state, "choice", question, (answer) => {
      if (
        typeof answer.choice !== "string" ||
        !(answer.choice in question.criteria)
      ) {
        return null;
      }
      return {
        choice: answer.choice as C,
        confidence: asNumber(answer.confidence),
        probabilities: asRecord(answer.probabilities) as
          | Partial<Record<C, number>>
          | undefined,
      };
    });
  }

  boolean(
    state: JevState,
    question: BooleanQuestion,
  ): Promise<JevResult<BooleanAnswer>> {
    return this.ask(state, "noul", question, (answer) => {
      if (typeof answer.noul !== "number") return null;
      return { probability: answer.noul };
    });
  }

  score(
    state: JevState,
    question: ScoreQuestion,
  ): Promise<JevResult<ScoreAnswer>> {
    return this.ask(state, "score", question, (answer) => {
      if (typeof answer.score !== "number") return null;
      return { score: answer.score, confidence: asNumber(answer.confidence) };
    });
  }

  private async ask<A>(
    state: JevState,
    type: "choice" | "noul" | "score",
    question: ChoiceQuestion<string> | BooleanQuestion | ScoreQuestion,
    parse: (answer: Record<string, unknown>) => A | null,
  ): Promise<JevResult<A>> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}/systemone`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          state,
          questions: { q: { type, ...question } },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      if (isTimeout(err)) return { ok: false, error: "timeout" };
      return { ok: false, error: "unavailable", detail: formatError(err) };
    }

    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      return {
        ok: false,
        error: "unavailable",
        detail: `http ${res.status}: ${detail}`,
      };
    }

    const data = (await res.json().catch(() => null)) as {
      answers?: Record<string, unknown>;
    } | null;
    const answer = data?.answers?.q;
    if (!isRecord(answer) || answer.type !== type) {
      return { ok: false, error: "unavailable", detail: "missing answers.q" };
    }
    const value = parse(answer);
    if (value === null) {
      return {
        ok: false,
        error: "unavailable",
        detail: "unexpected answers.q shape",
      };
    }
    return { ok: true, value };
  }
}

function isTimeout(err: unknown): boolean {
  const name = err instanceof Error ? err.name : "";
  return name === "TimeoutError" || name === "AbortError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function asRecord(value: unknown): Record<string, number> | undefined {
  return isRecord(value) ? (value as Record<string, number>) : undefined;
}

function formatError(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}
