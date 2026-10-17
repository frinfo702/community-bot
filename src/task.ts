import type { TurnResult } from "@cloudflare/think";

/** Runs one task turn on the agent (TaskAgent.handleTask). The type comes from the framework. */
export type TaskAsk = (input: string) => Promise<TurnResult>;

export interface TaskRun {
  text: string;
  /** Time the agent spent on the turn (cost hint) */
  ms: number;
}

/**
 * Run the task on the agent. Returns null when the turn failed or produced no
 * text, so the caller can fall back to the normal text reply.
 */
export async function runTask(
  input: string,
  ask: TaskAsk,
): Promise<TaskRun | null> {
  const startedAt = Date.now();
  try {
    const text = turnText(await ask(input));
    if (!text) return null;
    return { text, ms: Date.now() - startedAt };
  } catch (err) {
    console.error("task agent failed", err);
    return null;
  }
}

/** The assistant text of a completed turn, or null when there is none. */
export function turnText(turn: TurnResult): string | null {
  if (turn.status !== "completed") return null;
  const text = (turn.message?.parts ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
  return text || null;
}
