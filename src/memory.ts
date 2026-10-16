import type { Memory, MemoryActor } from "./conversation";
import { stripBotMentions } from "./discord/mention";
import type {
  BooleanQuestion,
  ChoiceAnswer,
  ChoiceQuestion,
  JevClient,
} from "./jev";
import type { ChatMessage } from "./llm";
import type { LoggedMessage } from "./prompt";

/** Reason recorded in memory_log when the existing memories are read. */
const READ_REASON = "抽出: 差分を決めるために既存記憶を読む";

/** Threshold on Jev's yes probability for "worth keeping" and "add a new memory". */
const PROBABILITY = 0.5;

/** Lines of the exchange passed to Jev (the trigger message, the reply, and their neighbors). */
const EXCHANGE_MESSAGES = 6;

/** Cap on the existing memories Jev reads at once. */
const DEFAULT_MEMORY_LIMIT = 10;

/** Verdict for one existing record. */
export type MemoryVerdict = "keep" | "update" | "delete";

/** A record Jev answered for (records Jev could not answer are left out). */
type JudgedMemory = { memory: Memory; answer: ChoiceAnswer<MemoryVerdict> };

/** One applied change. Its reason also goes into memory_log. */
export interface MemoryChange {
  action: "add" | "update" | "delete";
  recordId: string;
  reason: string;
}

export interface MemoryExtractionResult {
  /** Whether Jev found anything worth keeping. */
  worthRemembering: boolean;
  changes: MemoryChange[];
}

/** Memory read/write surface implemented by ConversationDO. reason lands in memory_log. */
export interface MemoryStore {
  memories(
    userId: string,
    limit: number,
    actor: MemoryActor,
    reason?: string,
  ): Promise<Memory[]>;
  appendMemory(
    userId: string,
    content: string,
    actor: MemoryActor,
    reason?: string,
  ): Promise<Memory>;
  updateMemory(
    id: string,
    content: string,
    actor: MemoryActor,
    reason?: string,
  ): Promise<Memory | null>;
  deleteMemory(id: string, actor: MemoryActor, reason?: string): Promise<boolean>;
}

export interface MemoryExtractionDeps {
  jev: Pick<JevClient, "boolean" | "choice">;
  store: MemoryStore;
  /** Writes the text. Only the records Jev pointed at and the exchange are passed. */
  generate: (messages: ChatMessage[]) => Promise<string>;
  memoryLimit?: number;
}

export interface ExtractionInput {
  /** The person the memory belongs to (speaker of the exchange; never the bot itself). */
  userId: string;
  userName: string;
  /** The recent exchange, oldest to newest; the tail is the trigger message or its reply. */
  messages: LoggedMessage[];
  botId: string;
}

/**
 * Extracts and applies memory changes from the recent exchange. Jev decides whether
 * it is worth keeping and which records to add / update / delete; the LLM only writes
 * the text for the records Jev pointed at. Nothing is written when Jev cannot answer,
 * so a failed decision never damages existing memories.
 */
export async function extractMemories(
  deps: MemoryExtractionDeps,
  input: ExtractionInput,
): Promise<MemoryExtractionResult> {
  const exchange = renderExchange(input.messages, input.botId);
  if (!exchange) return { worthRemembering: false, changes: [] };

  const worth = await deps.jev.boolean(
    { exchange },
    worthQuestion(input.userName),
  );
  if (!worth.ok || worth.value.probability < PROBABILITY) {
    return { worthRemembering: false, changes: [] };
  }

  const existing = await deps.store.memories(
    input.userId,
    deps.memoryLimit ?? DEFAULT_MEMORY_LIMIT,
    "extraction",
    READ_REASON,
  );
  // Records Jev could not answer are left untouched, so existing memories stay safe
  const verdicts = (
    await Promise.all(
      existing.map(async (memory): Promise<JudgedMemory | null> => {
        const result = await deps.jev.choice<MemoryVerdict>(
          { exchange, memory: { id: memory.id, content: memory.content } },
          verdictQuestion(input.userName),
        );
        return result.ok ? { memory, answer: result.value } : null;
      }),
    )
  ).filter((entry): entry is JudgedMemory => entry !== null);

  // Write the text for add and update together (the LLM sees only the target records and the exchange)
  const [addContent, rewrites] = await Promise.all([
    decideAdd(deps, input, exchange, verdicts, existing.length).then(({ add }) =>
      add ? write(deps, addPrompt(input.userName, exchange)) : null,
    ),
    Promise.all(
      verdicts
        .filter((entry) => entry.answer.choice === "update")
        .map(async (entry) => ({
          memory: entry.memory,
          answer: entry.answer,
          content: await write(
            deps,
            updatePrompt(input.userName, entry.memory.content, exchange),
          ),
        })),
    ),
  ]);

  const changes: MemoryChange[] = [];
  for (const entry of verdicts) {
    if (entry.answer.choice !== "delete") continue;
    const reason = reasonFor("delete", entry.answer, exchange);
    if (await deps.store.deleteMemory(entry.memory.id, "extraction", reason)) {
      changes.push({ action: "delete", recordId: entry.memory.id, reason });
    }
  }
  for (const rewrite of rewrites) {
    if (!rewrite.content) continue;
    const reason = reasonFor("update", rewrite.answer, exchange);
    const updated = await deps.store.updateMemory(
      rewrite.memory.id,
      rewrite.content,
      "extraction",
      reason,
    );
    if (updated) changes.push({ action: "update", recordId: updated.id, reason });
  }
  if (addContent) {
    const reason = reasonFor("add", null, exchange);
    const added = await deps.store.appendMemory(
      input.userId,
      addContent,
      "extraction",
      reason,
    );
    changes.push({ action: "add", recordId: added.id, reason });
  }

  return { worthRemembering: true, changes };
}

/** Asks Jev whether a new memory should be added. Records marked update already cover part of the diff. */
async function decideAdd(
  deps: MemoryExtractionDeps,
  input: ExtractionInput,
  exchange: string,
  verdicts: JudgedMemory[],
  total: number,
): Promise<{ add: boolean }> {
  if (total === 0) return { add: true };
  const result = await deps.jev.boolean(
    {
      exchange,
      memories: verdicts.map((entry) => ({
        content: entry.memory.content,
        verdict: entry.answer.choice,
      })),
    },
    addQuestion(input.userName),
  );
  if (!result.ok) return { add: false };
  return { add: result.value.probability >= PROBABILITY };
}

/** Lets the LLM write one piece. Failure, an empty answer, or NONE returns null (nothing is stored). */
async function write(
  deps: MemoryExtractionDeps,
  messages: ChatMessage[],
): Promise<string | null> {
  try {
    const content = (await deps.generate(messages)).trim();
    if (!content || content.toUpperCase() === "NONE") return null;
    return content;
  } catch {
    return null;
  }
}

/** Renders the recent exchange as text lines (the same shape used for the reply context). */
function renderExchange(messages: LoggedMessage[], botId: string): string {
  return messages
    .slice(-EXCHANGE_MESSAGES)
    .map((message) =>
      message.isBot
        ? `bot: ${message.content}`
        : `${message.authorName}: ${stripBotMentions(message.content, botId) || "(本文なし)"}`,
    )
    .join("\n");
}

/** Reason recorded in memory_log. Jev gives no prose reason, so the verdict and the new information are kept. */
function reasonFor(
  action: "add" | "update" | "delete",
  verdict: { choice: MemoryVerdict; confidence?: number } | null,
  exchange: string,
): string {
  const confidence =
    verdict?.confidence === undefined ? "" : ` confidence ${verdict.confidence}`;
  const summary = exchange.replace(/\n/g, " / ").slice(0, 160);
  return `Jev: ${action}${confidence} / 新情報: ${summary}`;
}

function worthQuestion(name: string): BooleanQuestion {
  return {
    instructions:
      `Does the latest exchange in this Discord conversation contain something about ${name} ` +
      "that their long-term profile should keep? Facts, preferences, plans, relationships, " +
      "ongoing situations. Not small talk, throwaway jokes, or the bot's own words.",
    criteria: {
      true: `${name} revealed or confirmed something that will still matter days later.`,
      false: "Only small talk, a reaction, or nothing durable about the person.",
    },
  };
}

function verdictQuestion(name: string): ChoiceQuestion<MemoryVerdict> {
  return {
    instructions:
      `Given the latest exchange, what should happen to the existing memory about ${name}? ` +
      "Choose update or delete only when the exchange clearly changes it; otherwise keep.",
    criteria: {
      keep: "Still accurate and useful as it is; the exchange does not change it.",
      update: "The exchange refines, extends, or corrects it, so it should be rewritten.",
      delete: "The exchange makes it false or obsolete, so it should be removed.",
    },
  };
}

function addQuestion(name: string): BooleanQuestion {
  return {
    instructions:
      `Does the latest exchange contain new information about ${name} that none of the listed ` +
      "memories will cover? Memories with verdict update are being rewritten to cover it.",
    criteria: {
      true: "At least one new fact or preference is not covered by the existing memories.",
      false: "Everything worth keeping is already covered by the existing memories.",
    },
  };
}

const WRITER_SYSTEM =
  "You maintain the short private memory notes a friendly Discord bot keeps about its members. " +
  "Write in Japanese as one plain factual sentence. No preamble, no quotes, no name prefix.";

function addPrompt(name: string, exchange: string): ChatMessage[] {
  return [
    { role: "system", content: WRITER_SYSTEM },
    {
      role: "user",
      content:
        `# 新しいやり取り\n${exchange}\n\n` +
        `${name} について次回以降も覚えておくことを1文で書け。無ければ NONE とだけ出力しろ。`,
    },
  ];
}

function updatePrompt(
  name: string,
  memory: string,
  exchange: string,
): ChatMessage[] {
  return [
    { role: "system", content: WRITER_SYSTEM },
    {
      role: "user",
      content:
        `# 既存の記憶\n${memory}\n\n# 新しいやり取り\n${exchange}\n\n` +
        `上の記憶を、新しいやり取りを踏まえた${name}についての1文に書き直せ。` +
        "記憶に無いことを足すな。書き直す必要が無ければ NONE とだけ出力しろ。",
    },
  ];
}
