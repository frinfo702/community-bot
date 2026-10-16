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

/** 記憶を読むときに memory_log へ残す理由。 */
const READ_REASON = "抽出: 差分を決めるために既存記憶を読む";

/** 「記憶に残す価値がある」「新しい記憶を足す」のしきい値（Jev の yes 確率）。 */
const PROBABILITY = 0.5;

/** Jev に渡すやり取りの行数（トリガー発言と返信、その周辺だけ）。 */
const EXCHANGE_MESSAGES = 6;

/** Jev に読ませる既存記憶の上限。 */
const DEFAULT_MEMORY_LIMIT = 10;

/** 既存レコード1件への判断。 */
export type MemoryVerdict = "keep" | "update" | "delete";

/** Jev が判断を返した1件（聞けなかったレコードは含めない）。 */
type JudgedMemory = { memory: Memory; answer: ChoiceAnswer<MemoryVerdict> };

/** 適用した1件の変更。memory_log の理由にも使う。 */
export interface MemoryChange {
  action: "add" | "update" | "delete";
  recordId: string;
  reason: string;
}

export interface MemoryExtractionResult {
  /** 記憶に残す価値があると Jev が判断したか */
  worthRemembering: boolean;
  changes: MemoryChange[];
}

/** 記憶の読み書き。ConversationDO が実装する。reason は memory_log に残る。 */
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
  /** 文面を作る。渡すのは Jev が指したレコードと今回のやり取りだけ */
  generate: (messages: ChatMessage[]) => Promise<string>;
  memoryLimit?: number;
}

export interface ExtractionInput {
  /** 記憶を持つ相手（直近のやり取りの発言者。bot 自身は含めない） */
  userId: string;
  userName: string;
  /** 直近のやり取り（古い→新しい）。末尾がトリガー発言かその返信 */
  messages: LoggedMessage[];
  botId: string;
}

/**
 * 直近のやり取りから記憶の差分を抽出して適用する。Jev が価値の有無と
 * add / update / delete を決め、LLM は Jev が指したレコードの文面だけを書く。
 * Jev に聞けないときは何も書かない（誤って記憶を壊さない）。
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
  // 聞けなかったレコードは触らない（既存の記憶を守る）
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

  // 文面は add と update でまとめて作りにいく（LLM に渡すのは該当レコードとやり取りだけ）
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

/** 新しい記憶を足すかどうかを Jev に聞く。update 対象のレコードは差分の一部とみなす。 */
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

/** LLM に1手だけ書かせる。失敗・空・NONE は null（記憶を書かない）。 */
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

/** 直近のやり取りを行単位のテキストにする（返信の文脈と同じ見せ方）。 */
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

/** memory_log に残す理由。Jev は理由を文章で返さないので判定と新情報を残す。 */
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
