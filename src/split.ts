/**
 * A reply is normally one message. The model may ask for two (sometimes three)
 * by putting a line with exactly this marker between the parts, so a longer
 * answer arrives as separate chat messages instead of one wall of text.
 */
export const SPLIT_MARKER = "===";

/** How many messages one reply may become before the tail is merged. */
const MAX_PARTS = 3;

/**
 * Split a reply into at most MAX_PARTS messages: on marker lines, trimmed,
 * empty parts dropped, and overflow parts merged into the last message. The
 * 2000-character cut stays with the Discord client, the one place that posts.
 */
export function splitReply(text: string): string[] {
  const parts = text
    .split(new RegExp(`^\\s*${SPLIT_MARKER}\\s*$`, "m"))
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) return [];

  const kept = parts.slice(0, MAX_PARTS);
  if (parts.length > MAX_PARTS) {
    kept[MAX_PARTS - 1] += `\n\n${parts.slice(MAX_PARTS).join("\n\n")}`;
  }
  return kept;
}
