import type { Env } from "./env";
import { stripBotMentions } from "./discord/mention";

/** Max memories shown by `show`. Kept small so the list fits one message. */
export const SHOW_LIMIT = 10;

/** Per-item display length, so the id stays visible in the message. */
const CONTENT_LIMIT = 80;

export type MemoryCommand =
  | { action: "show" }
  | { action: "forget"; target: string }
  | { action: "help" };

/**
 * The `/memory` application command. `PUT /applications/{id}/commands` replaces
 * the whole global list, so this is the single source of truth for registration.
 * Types: 1 = subcommand, 3 = string.
 */
export const MEMORY_COMMAND = {
  name: "memory",
  description: "あなたの記憶を一覧・削除する",
  options: [
    { type: 1, name: "show", description: "あなたの記憶を一覧する" },
    {
      type: 1,
      name: "forget",
      description: "あなたの記憶を削除する",
      options: [
        {
          type: 3,
          name: "id",
          description: "削除する記憶のid。すべて削除する場合は all",
          required: true,
        },
      ],
    },
  ],
};

/** An option as Discord sends it in an interaction. */
export interface InteractionOption {
  name: string;
  value?: unknown;
  options?: InteractionOption[];
}

/**
 * Parse the `/memory` options into the same command the text parser returns.
 * Discord enforces the required `id`, so anything else falls back to help.
 */
export function parseMemoryInteraction(
  options: InteractionOption[] | undefined,
): MemoryCommand {
  const subcommand = options?.find(
    (option) => option.name === "show" || option.name === "forget",
  );
  if (subcommand?.name === "show") return { action: "show" };
  if (subcommand?.name === "forget") {
    const id = subcommand.options?.find((option) => option.name === "id")?.value;
    if (typeof id === "string" && id) return { action: "forget", target: id };
  }
  return { action: "help" };
}

/** The ConversationDO behind the command store. Reads and deletes use actor=command. */
export function memoryStore(env: Env): MemoryStore {
  const conversation = env.CONVERSATION.get(env.CONVERSATION.idFromName("log"));
  return {
    list: (userId, limit) => conversation.memories(userId, limit, "command"),
    forget: (id, userId) => conversation.forgetMemory(id, userId, "command"),
    forgetAll: (userId) => conversation.forgetAllMemories(userId, "command"),
  };
}

/**
 * Parse a text command. Only `!memory ...` and mentions followed by
 * `memory ...` count as commands; anything else returns null (normal chat).
 * The `/memory` slash command is parsed by parseMemoryInteraction.
 */
export function parseMemoryCommand(
  content: string,
  botId: string,
): MemoryCommand | null {
  const mentioned = content.includes(botId);
  const stripped = stripBotMentions(content, botId);

  let rest: string;
  if (/^!memory\b/.test(stripped)) {
    rest = stripped.slice("!memory".length);
  } else if (mentioned && /^memory\b/.test(stripped)) {
    rest = stripped.slice("memory".length);
  } else {
    return null;
  }

  const args = rest.trim().split(/\s+/).filter(Boolean);
  if (args[0] === "show") return { action: "show" };
  if (args[0] === "forget" && args[1]) {
    return { action: "forget", target: args[1] };
  }
  return { action: "help" };
}

/** Memory operations the command needs. Tests inject a fake store. */
export interface MemoryStore {
  list(
    userId: string,
    limit: number,
  ): Promise<Array<{ id: string; content: string }>>;
  forget(
    id: string,
    userId: string,
  ): Promise<"deleted" | "not_found" | "not_owner">;
  forgetAll(userId: string): Promise<number>;
}

/** Minimal Discord surface used to deliver command replies. */
export interface CommandReplyClient {
  openDM(userId: string): Promise<string>;
  postMessage(
    channelId: string,
    content: string,
    options?: { replyTo?: string },
  ): Promise<unknown>;
}

/**
 * Sends the memory list to the author's DM. The `/memory show` slash command
 * answers ephemerally instead; this is the path for the text command. When the
 * bot cannot DM the user it says so in the channel without echoing them.
 */
export async function sendMemoryList(
  discord: CommandReplyClient,
  message: {
    id: string;
    channel_id: string;
    guild_id?: string;
    author: { id: string };
  },
  reply: string,
): Promise<void> {
  try {
    const dm = await discord.openDM(message.author.id);
    await discord.postMessage(dm, reply);
    if (message.guild_id) {
      await discord.postMessage(message.channel_id, "記憶はDMに送りました。", {
        replyTo: message.id,
      });
    }
  } catch (err) {
    console.error("memory dm failed", message.author.id, err);
    await discord.postMessage(
      message.channel_id,
      "DMを送れませんでした。DMの受信設定を確認してください。",
      { replyTo: message.id },
    );
  }
}

/** Run the command and return the reply text. Deletes target the caller only. */
export async function runMemoryCommand(
  command: MemoryCommand,
  userId: string,
  store: MemoryStore,
): Promise<string> {
  if (command.action === "show") {
    const rows = await store.list(userId, SHOW_LIMIT);
    if (rows.length === 0) {
      return "あなたの記憶はまだありません。";
    }
    const lines = rows.map(
      (row) =>
        `- \`${row.id}\` ${row.content.slice(0, CONTENT_LIMIT)}${row.content.length > CONTENT_LIMIT ? "…" : ""}`,
    );
    const notice =
      rows.length === SHOW_LIMIT
        ? `\n（最新${SHOW_LIMIT}件だけ表示しています）`
        : "";
    return `あなたの記憶（${rows.length}件）:\n${lines.join("\n")}${notice}`;
  }

  if (command.action === "forget") {
    if (command.target === "all") {
      const count = await store.forgetAll(userId);
      return count === 0
        ? "あなたの記憶はまだありません。"
        : `あなたの記憶を${count}件削除しました。`;
    }
    const result = await store.forget(command.target, userId);
    if (result === "deleted") return `記憶 \`${command.target}\` を削除しました。`;
    if (result === "not_owner") {
      return "その記憶はあなたのものではないので削除できません。";
    }
    return `記憶 \`${command.target}\` は見つかりません。`;
  }

  return [
    "使い方:",
    "- `/memory show` — あなたの記憶を一覧する",
    "- `/memory forget id:<id>` — id の記憶を削除する",
    "- `/memory forget id:all` — あなたの記憶をすべて削除する",
    "`!memory show` やメンション付きの `memory show` でも同じです。",
  ].join("\n");
}
