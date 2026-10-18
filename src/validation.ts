import type { BooleanQuestion, JevClient } from "./jev";

/** Lines of the preceding turn the repeat gate reads. */
export const PRECEDING_LINES = 6;

/** Jev yes-threshold for "the reply repeats the preceding turn". */
export const REPEAT_THRESHOLD = 0.5;

/**
 * Sentences judged one by one after a hit, so a very long reply stays bounded
 * in Jev calls. shortcut: a repeat past the eighth sentence is not located;
 * raise this when replies grow long.
 */
const SENTENCE_JUDGEMENTS = 8;

/** Generations allowed in total, including the first. The second is the only retry. */
const ATTEMPTS = 2;

/** What one gate reads: the generated text and the turn it answers. */
export interface GateInput {
  text: string;
  /** The preceding turn as log lines ("name: body"), oldest first. */
  preceding: string[];
}

/** Verdict of one gate. A failing gate points at the sentences to cut. */
export type GateVerdict =
  | { pass: true }
  | { pass: false; cut: string[]; reason: string };

/** One check a generated reply passes before it is posted. */
export interface ReplyGate {
  name: string;
  check(input: GateInput): Promise<GateVerdict>;
}

/** A generation a gate stopped: what to cut, why, and the text as generated. */
export interface RejectedReply {
  gate: string;
  cut: string[];
  reason: string;
  text: string;
}

/** What the retry writes from: the reply after the cut, plus what was withheld and cut. */
export interface RetryInput {
  text: string;
  withheld: string;
  cut: string[];
}

export interface ReviewDeps {
  gates: ReplyGate[];
  /** Asks the chat model for the reply again, from the cut text. */
  retry(input: RetryInput): Promise<string>;
  /** Called for every withheld generation, so the caller can record it. */
  onReject(rejection: RejectedReply): void | Promise<void>;
  log(message: string): void;
}

/**
 * Runs every gate on a generated reply and, when one fails, cuts the sentences
 * it pointed at and asks the model for the reply again, until the gates pass or
 * the attempt budget runs out. It returns the text to post: the cut remainder
 * when the last generation still failed, and "" when the cut left nothing. A
 * retry that fails leaves the cut text in place, so the repeated lines never
 * reach the reader.
 */
export async function reviewReply(
  deps: ReviewDeps,
  input: GateInput,
): Promise<string> {
  let text = input.text;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const rejection = await failedGate(deps.gates, {
      text,
      preceding: input.preceding,
    });
    if (!rejection) return text;

    deps.log(
      `withheld by ${rejection.gate}: ${rejection.reason}` +
        (rejection.cut.length > 0 ? ` / cut: ${rejection.cut.join(" ")}` : ""),
    );
    await deps.onReject(rejection);
    text = withoutSentences(text, rejection.cut);
    if (attempt === ATTEMPTS) break;

    try {
      text = (
        await deps.retry({
          text,
          withheld: rejection.text,
          cut: rejection.cut,
        })
      ).trim();
    } catch (err) {
      deps.log(
        `retry failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      break;
    }
  }
  return text;
}

/** The first gate that failed, with the text it rejected; null when the reply passed. */
async function failedGate(
  gates: ReplyGate[],
  input: GateInput,
): Promise<RejectedReply | null> {
  for (const gate of gates) {
    const verdict = await gate.check(input);
    if (!verdict.pass) {
      return {
        gate: gate.name,
        cut: verdict.cut,
        reason: verdict.reason,
        text: input.text,
      };
    }
  }
  return null;
}

/**
 * Jev gate: does the reply repeat the turn before it? On a hit Jev is asked per
 * sentence, so only the repeated sentences are cut. If Jev cannot be asked, the
 * reply passes: withholding one costs the member more than a repeated line.
 */
export function repeatGate(jev: Pick<JevClient, "boolean">): ReplyGate {
  return {
    name: "repeat",
    async check({ text, preceding }) {
      const result = await jev.boolean(
        repeatState(preceding, text),
        REPEAT_QUESTION,
      );
      if (!result.ok || result.value.probability < REPEAT_THRESHOLD) {
        return { pass: true };
      }
      return {
        pass: false,
        reason: `repeats the preceding turn (p=${result.value.probability.toFixed(2)})`,
        cut: await repeatedSentences(jev, preceding, text),
      };
    },
  };
}

/** The state both repeat questions read: the preceding turn, then the text under review. */
function repeatState(preceding: string[], text: string): string {
  return ["Preceding turn:", ...preceding, "", "Reply:", text].join("\n");
}

/** One question per sentence, so only the repeated parts are cut. */
async function repeatedSentences(
  jev: Pick<JevClient, "boolean">,
  preceding: string[],
  text: string,
): Promise<string[]> {
  const judged = await Promise.all(
    sentences(text).slice(0, SENTENCE_JUDGEMENTS).map(async (sentence) => {
      const result = await jev.boolean(
        repeatState(preceding, sentence),
        REPEAT_QUESTION,
      );
      return result.ok && result.value.probability >= REPEAT_THRESHOLD
        ? sentence
        : null;
    }),
  );
  return judged.filter((sentence): sentence is string => sentence !== null);
}

const REPEAT_QUESTION: BooleanQuestion = {
  instructions:
    "The bot is about to post its reply in this Discord conversation. Does the reply say again something the conversation already said?",
  criteria: {
    true: "The reply repeats one of the lines of the preceding turn, so the reader reads the same sentence twice.",
    false:
      "The reply answers with something not said yet. Answering shortly, or reusing a word, a name or a greeting, is not a repeat.",
  },
};

/** Sentences of a reply. Line breaks and the Japanese and Latin end marks split them. */
export function sentences(text: string): string[] {
  return text.split(/(?<=[。．！？!?\n])/).filter((s) => s.trim().length > 0);
}

/** The same text with the given sentences removed, and nothing else touched. */
function withoutSentences(text: string, cut: string[]): string {
  if (cut.length === 0) return text;
  const dropped = new Set(cut);
  return sentences(text)
    .filter((sentence) => !dropped.has(sentence))
    .join("")
    .trim();
}
