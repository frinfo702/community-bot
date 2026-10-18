/**
 * A reply is normally one message. The model may ask for two (sometimes three)
 * by putting a line with exactly this marker between the parts, so a longer
 * answer arrives as separate chat messages instead of one wall of text.
 */
export const SPLIT_MARKER = "===";

/** How many messages one reply may become before the tail is merged. */
const MAX_PARTS = 3;

const PART_LIMIT = 2000;

/**
 * Split a reply into at most MAX_PARTS messages: on marker lines, trimmed, empty
 * parts dropped, and overflow parts merged into the last message. A single part
 * longer than Discord's limit is cut, the same as before this feature.
 */
export function splitReply(text: string, limit = PART_LIMIT): string[] {
  const parts = text
    .split(new RegExp(`^\\s*${SPLIT_MARKER}\\s*$`, "m"))
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) return [];

  const kept = parts.slice(0, MAX_PARTS);
  if (parts.length > MAX_PARTS) {
    kept[MAX_PARTS - 1] += `\n\n${parts.slice(MAX_PARTS).join("\n\n")}`;
  }
  return kept.map((part) => part.slice(0, limit));
}
