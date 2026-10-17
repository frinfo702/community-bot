import { decisionState } from "./decisions";
import type { ChoiceAnswer, ChoiceQuestion, JevClient } from "./jev";
import type { ChannelContext } from "./prompt";

/** Emoji used when Jev cannot be asked at all. */
export const STAMP_FALLBACK = "👍";

/** Emojis kept from one ranking. The pick rotates over them so a category does not repeat one emoji forever. */
const RANKING_SIZE = 3;

/** How long the guild's custom emoji list is reused before asking Discord again. */
const CUSTOM_EMOJI_TTL_MS = 60 * 60 * 1000;

/** Question for the emoji inside one category. Hoisted because the wording is part of the cache version. */
const LEAF_INSTRUCTIONS =
  "Which emoji reaction best expresses the reaction described in `reaction`?";

/** A custom emoji of the guild. The reaction form is `name:id`. */
export interface CustomEmoji {
  id: string;
  name: string;
}

interface StampOption {
  /** Unicode emoji, or `name:id` for a guild custom emoji. */
  emoji: string;
  /** Jev criteria for this option. */
  description: string;
}

/** One reaction the bot can express, with the emojis that express it. */
interface StampSet {
  /** Jev criteria when the reaction itself is the choice (reply mode). */
  description: string;
  emojis: StampOption[];
}

/** Reaction kinds for "the emoji alone is the reply". */
const REPLY_SETS = {
  agree: {
    description:
      "The bot agrees with the message or gives a plain acknowledgment; words are not needed.",
    emojis: [
      { emoji: "👍", description: "Agreement or approval." },
      { emoji: "🙌", description: "Wholehearted agreement." },
      { emoji: "👏", description: "Praise for what the person said or did." },
      { emoji: "💯", description: "Exactly right." },
      { emoji: "🤝", description: "Agreed; going with it." },
    ],
  },
  laugh: {
    description: "The message is funny; the bot is laughing or playful.",
    emojis: [
      { emoji: "😂", description: "A big laugh." },
      { emoji: "🤣", description: "Laughing hard at a joke." },
      { emoji: "😆", description: "Amused, grinning." },
      { emoji: "😹", description: "Amused by something silly." },
      { emoji: "🤭", description: "Giggling; amused but a little shy or teasing." },
    ],
  },
  warm: {
    description:
      "The bot is happy, thankful, or fond of the person or the message.",
    emojis: [
      { emoji: "🥰", description: "Fondness or affection." },
      { emoji: "😍", description: "Delight; loving it." },
      { emoji: "🙏", description: "Thanking the person." },
      { emoji: "😊", description: "A soft, happy smile." },
      { emoji: "🫶", description: "A warm heart for the person." },
    ],
  },
  celebrate: {
    description: "Something good happened or is being celebrated.",
    emojis: [
      { emoji: "🎉", description: "Congratulations or good news." },
      { emoji: "🎊", description: "A big celebration." },
      { emoji: "🥳", description: "Party mood." },
      { emoji: "🔥", description: "Hype; something is excellent." },
      { emoji: "✨", description: "Something nice and sparkling." },
    ],
  },
  sympathize: {
    description:
      "The message is sad or hard; the bot sympathizes, comforts, or cheers the person on.",
    emojis: [
      { emoji: "😢", description: "Sympathy for something sad." },
      { emoji: "🥺", description: "A soft, worried sympathy." },
      { emoji: "🫂", description: "A comforting hug." },
      { emoji: "💪", description: "Cheering the person on." },
      { emoji: "😌", description: "Soothing; it is okay." },
    ],
  },
  surprised: {
    description: "The message is surprising or hard to believe.",
    emojis: [
      { emoji: "😮", description: "A mild surprise." },
      { emoji: "😲", description: "A strong surprise." },
      { emoji: "🤯", description: "Mind blown; astonishing." },
    ],
  },
  interested: {
    description: "The bot is drawn in and wants to see or hear more.",
    emojis: [
      { emoji: "👀", description: "Paying attention; waiting to see more." },
      { emoji: "🤩", description: "Impressed or excited." },
      { emoji: "🔍", description: "Looking into it; inspecting closely." },
    ],
  },
  think: {
    description:
      "The bot is not sure, is thinking it over, or is a little skeptical.",
    emojis: [
      { emoji: "🤔", description: "Thinking it over; depends." },
      { emoji: "🧐", description: "Examining the details." },
      { emoji: "🤨", description: "Skeptical; really?" },
      { emoji: "😅", description: "Awkward; not sure how to react." },
    ],
  },
} satisfies Record<string, StampSet>;

export type StampCategory = keyof typeof REPLY_SETS;

/** Reaction for the read receipt sent when a long task starts. Never chosen per message. */
const ACK_SET: StampSet = {
  description:
    "The bot has seen the request and is working on it; the full answer will take a while.",
  emojis: [
    { emoji: "👀", description: "Seen; taking a look." },
    { emoji: "🫡", description: "Understood; on it." },
    { emoji: "⏳", description: "Working on it; it will take a while." },
    { emoji: "📝", description: "Noted; working through it." },
    { emoji: "✅", description: "Accepted; the bot will handle it." },
  ],
};

/** Why the reaction is sent: the emoji alone is the reply, or a read receipt for a long task. */
export type StampMode = "reply" | "ack";

/** Cache surface implemented by ConversationDO. */
export interface StampStore {
  /** Cached ranking (best first) for one reaction category; null when missing or built from other emoji sets. */
  stampRanking(
    scope: string,
    category: string,
    version: string,
  ): Promise<string[] | null>;
  saveStampRanking(
    scope: string,
    category: string,
    version: string,
    ranking: string[],
  ): Promise<void>;
  /** The guild's custom emoji list while it is still fresh; null when missing or stale. */
  guildEmojis(
    scope: string,
    freshWithinMs: number,
  ): Promise<CustomEmoji[] | null>;
  saveGuildEmojis(scope: string, emojis: CustomEmoji[]): Promise<void>;
}

export interface StampDeps {
  jev: Pick<JevClient, "choice">;
  store: StampStore;
}

export interface StampInput {
  /** Cache scope: the guild id ("dm" in DMs, which have no custom emojis). */
  scope: string;
  context: ChannelContext;
  botId: string;
  mode: StampMode;
  /** The guild's custom emojis, added as candidates to every category. */
  custom: CustomEmoji[];
}

export interface StampDecision {
  emoji: string;
  /** Reaction category, or null when the category could not be decided. */
  category: StampCategory | "ack" | null;
  /** True when the ranking was served from the cache, so no emoji question was sent. */
  cached: boolean;
  /** True when Jev could not be asked and the decision fell back. */
  fallback: boolean;
}

/**
 * Picks the reaction emoji. First the category is decided from the conversation
 * (a small fixed set), then the emoji from that category's candidates. The
 * category ranking is cached, so the full candidate list is only ever evaluated
 * once per category and emoji set — never on every message.
 */
export async function decideStamp(
  deps: StampDeps,
  input: StampInput,
): Promise<StampDecision> {
  const choice = input.mode === "ack"
    ? { name: "ack" as const, set: ACK_SET }
    : await replyChoice(deps.jev, input);
  if (!choice) {
    return { emoji: STAMP_FALLBACK, category: null, cached: false, fallback: true };
  }

  const version = stampVersion(input.custom);
  const cached = await deps.store.stampRanking(input.scope, choice.name, version);
  if (cached && cached.length > 0) {
    return { emoji: pick(cached), category: choice.name, cached: true, fallback: false };
  }

  const criteria = leafCriteria(choice.set, input.custom);
  const answered = await deps.jev.choice(
    { reaction: choice.set.description },
    { instructions: LEAF_INSTRUCTIONS, criteria },
  );
  if (!answered.ok) {
    return {
      emoji: choice.set.emojis[0].emoji,
      category: choice.name,
      cached: false,
      fallback: true,
    };
  }

  const ranking = rankLeaf(answered.value, criteria);
  await deps.store.saveStampRanking(input.scope, choice.name, version, ranking);
  return { emoji: pick(ranking), category: choice.name, cached: false, fallback: false };
}

/** The guild's custom emojis. Fetched at most once per TTL; an empty list is a working fallback. */
export async function guildStampEmojis(
  deps: {
    discord: { listGuildEmojis(guildId: string): Promise<CustomEmoji[]> };
    store: StampStore;
  },
  guildId: string | undefined,
): Promise<CustomEmoji[]> {
  if (!guildId) return []; // DMs have no custom emojis
  const cached = await deps.store.guildEmojis(guildId, CUSTOM_EMOJI_TTL_MS);
  if (cached) return cached;
  try {
    const emojis = await deps.discord.listGuildEmojis(guildId);
    await deps.store.saveGuildEmojis(guildId, emojis);
    return emojis;
  } catch (err) {
    // The stamp still works with Unicode emojis; the next message retries
    console.error("guild emoji list failed", guildId, err);
    return [];
  }
}

/** Version of everything a cached ranking was built from. Changing any of it makes the cache stale. */
export function stampVersion(custom: CustomEmoji[]): string {
  const sets = JSON.stringify({
    reply: REPLY_SETS,
    ack: ACK_SET,
    leaf: LEAF_INSTRUCTIONS,
    customHint: customHint("name"),
    ranking: RANKING_SIZE,
    custom: custom.map((emoji) => `${emoji.name}:${emoji.id}`).sort(),
  });
  // FNV-1a over the catalog; only equality matters, not the hash quality
  let hash = 0x811c9dc5;
  for (let i = 0; i < sets.length; i++) {
    hash ^= sets.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/** Category decision for the emoji-only reply. Null when Jev cannot be asked. */
async function replyChoice(
  jev: Pick<JevClient, "choice">,
  input: StampInput,
): Promise<{ name: StampCategory; set: StampSet } | null> {
  const result = await jev.choice(
    decisionState(input.context, input.botId),
    REPLY_QUESTION,
  );
  return result.ok
    ? { name: result.value.choice, set: REPLY_SETS[result.value.choice] }
    : null;
}

const REPLY_QUESTION: ChoiceQuestion<StampCategory> = {
  instructions:
    "The bot answers the latest message with a single emoji reaction and no words. " +
    "Which reaction best expresses what the bot wants to express about that message?",
  criteria: Object.fromEntries(
    Object.entries(REPLY_SETS).map(([name, set]) => [name, set.description]),
  ) as Record<StampCategory, string>,
};

/** The emoji candidates of one category: its Unicode emojis plus every custom emoji of the guild. */
function leafCriteria(
  set: StampSet,
  custom: CustomEmoji[],
): Record<string, string> {
  const criteria: Record<string, string> = {};
  for (const option of set.emojis) criteria[option.emoji] = option.description;
  for (const emoji of custom) {
    criteria[`${emoji.name}:${emoji.id}`] = customHint(emoji.name);
  }
  return criteria;
}

// shortcut: custom emojis are judged by the name alone; upgrade when the names
// prove too ambiguous to pick well
function customHint(name: string): string {
  return `Guild custom emoji named "${name}"; its appearance is not shown, so judge by the name.`;
}

/** Ranking of the leaf answer over the offered candidates, best first. */
function rankLeaf(
  answer: ChoiceAnswer<string>,
  candidates: Record<string, string>,
): string[] {
  const probabilities = answer.probabilities ?? {};
  const ranked = Object.keys(candidates)
    .filter((emoji) => typeof probabilities[emoji] === "number")
    .sort((a, b) => (probabilities[b] ?? 0) - (probabilities[a] ?? 0));
  // Keep the answered choice even when the probabilities are missing
  if (!ranked.includes(answer.choice)) ranked.unshift(answer.choice);
  return ranked.slice(0, RANKING_SIZE);
}

function pick(options: string[]): string {
  return options[Math.floor(Math.random() * options.length)];
}
