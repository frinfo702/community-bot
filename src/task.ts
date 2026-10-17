import type { TurnResult } from "@cloudflare/think";

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
