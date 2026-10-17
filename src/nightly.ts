import type { Memory } from "./conversation";
import type { ChoiceQuestion, JevClient } from "./jev";
import type { ChatMessage } from "./llm";
import { extractMemories, type MemoryChange, type MemoryStore } from "./memory";
import type { LoggedMessage } from "./prompt";

/** Lookback of one run. The alarm fires at 03:00 JST, so this is the previous day. */
const NIGHTLY_WINDOW_MS = 24 * 60 * 60 * 1000;

/** A memory is reviewed by the decay pass after this long without an update. */
export const DECAY_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Cap on decay reviews per night. The cap is what bounds the cost; memories Jev
 * decides to keep stay in the stale set and are reviewed again the next night.
 */
export const NIGHTLY_STALE_LIMIT = 20;

/** Messages per extraction call. Same size as the exchange memory.ts renders. */
export const NIGHTLY_CHUNK_MESSAGES = 6;

/** Per speaker per night, so a very chatty day stays bounded in Jev / LLM calls. */
export const NIGHTLY_MAX_CHUNKS = 5;

/** Hours of the conversation passed to the diary prompt. */
const DIARY_MESSAGES = 30;

/** Hour (UTC) the nightly alarm fires: 18:00 UTC = 03:00 JST. */
export const NIGHTLY_HOUR_UTC = 18;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The first 18:00 UTC strictly after `now`. */
export function nextNightlyAt(now: number): number {
  const target = Math.floor(now / DAY_MS) * DAY_MS + NIGHTLY_HOUR_UTC * 60 * 60 * 1000;
  return target > now ? target : target + DAY_MS;
}

/** JST date (UTC+9) of the window start. The run at 03:00 JST covers the previous day. */
export function dayLabel(since: number): string {
  return new Date(since + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Memory read/write surface plus the two scans the nightly run needs. */
export interface NightlyStore extends MemoryStore {
  /** Non-bot messages in [since, until), oldest first. */
  messagesSince(since: number, until: number): Promise<LoggedMessage[]>;
  /** Memories not updated since `before`, oldest first. */
  staleMemories(before: number, limit: number): Promise<Memory[]>;
}

/** What one run did, stored as JSON in nightly_runs. */
export interface NightlySummary {
  messages: number;
  speakers: number;
  changes: MemoryChange[];
  /** Record ids the decay pass deleted (a subset of changes). */
  decayed: string[];
}

export interface NightlyRun {
  day: string;
  diary: string;
  summary: NightlySummary;
  startedAt: number;
  finishedAt: number;
}

export interface NightlyRunRecord extends NightlyRun {
  id: number;
  rolledBack: boolean;
}

export interface NightlyDeps {
  store: NightlyStore;
  jev: Pick<JevClient, "boolean" | "choice">;
  /** Writes the diary and the memory texts. Failures return an empty text, never throw. */
  generate(messages: ChatMessage[]): Promise<string>;
  record(run: NightlyRun): Promise<NightlyRunRecord>;
  log(message: string): void;
  botId: string;
  /** Clock. Fixed in tests. */
  now?: number;
}

/**
 * Nightly memory consolidation (ISSUE-1874). Jev decides whether each day's
 * messages are worth keeping, which records to merge, and which stale ones to
 * drop; the LLM only writes the text. Nothing is written when Jev cannot answer.
 * Returns null when the day has no messages (nothing to consolidate).
 */
export async function runNightlyConsolidation(
  deps: NightlyDeps,
): Promise<NightlyRunRecord | null> {
  const now = deps.now ?? Date.now();
  const since = now - NIGHTLY_WINDOW_MS;
  const messages = await deps.store.messagesSince(since, now);
  if (messages.length === 0) {
    deps.log("no messages; skipped");
    return null;
  }

  const speakers = groupBySpeaker(messages);
  const changes: MemoryChange[] = [];
  for (const [userId, speaker] of speakers) {
    for (const chunk of chunks(speaker.messages)) {
      try {
        const result = await extractMemories(
          {
            jev: deps.jev,
            store: deps.store,
            generate: deps.generate,
            actor: "nightly",
          },
          {
            userId,
            userName: speaker.name,
            messages: chunk,
            botId: deps.botId,
          },
        );
        changes.push(...result.changes);
      } catch (err) {
        // One failing speaker must not stop the rest of the night
        deps.log(`merge failed for ${speaker.name}: ${errorText(err)}`);
      }
    }
  }

  const decayed: string[] = [];
  for (const memory of await deps.store.staleMemories(
    now - DECAY_AFTER_MS,
    NIGHTLY_STALE_LIMIT,
  )) {
    const change = await reviewStaleMemory(deps, memory, now);
    if (!change) continue;
    changes.push(change);
    decayed.push(change.recordId);
  }

  const diary = await writeDiary(deps, messages, dayLabel(since));
  const summary: NightlySummary = {
    messages: messages.length,
    speakers: speakers.size,
    changes,
    decayed,
  };
  const run = await deps.record({
    day: dayLabel(since),
    diary,
    summary,
    startedAt: now,
    finishedAt: Date.now(),
  });
  // The change summary goes to the log as well, per the issue's acceptance criteria
  deps.log(
    `day=${run.day} messages=${summary.messages} speakers=${summary.speakers}` +
      ` ${counts(changes)} decayed=${decayed.length} diary=${diary}` +
      (changes.length
        ? `\n${changes.map((change) => `${change.action} ${change.recordId}`).join("\n")}`
        : ""),
  );
  return run;
}

interface Speaker {
  /** Latest display name of the speaker. */
  name: string;
  messages: LoggedMessage[];
}

/** Group by speaker, keeping each speaker's messages oldest first. */
function groupBySpeaker(messages: LoggedMessage[]): Map<string, Speaker> {
  const speakers = new Map<string, Speaker>();
  for (const message of messages) {
    const speaker = speakers.get(message.authorId);
    if (speaker) {
      speaker.name = message.authorName;
      speaker.messages.push(message);
    } else {
      speakers.set(message.authorId, {
        name: message.authorName,
        messages: [message],
      });
    }
  }
  return speakers;
}

/**
 * Split one speaker's day into extraction windows. Only the newest
 * NIGHTLY_MAX_CHUNKS are used, so a very active day cannot multiply the
 * Jev / LLM calls without bound.
 */
function chunks(messages: LoggedMessage[]): LoggedMessage[][] {
  const windows: LoggedMessage[][] = [];
  for (let i = 0; i < messages.length; i += NIGHTLY_CHUNK_MESSAGES) {
    windows.push(messages.slice(i, i + NIGHTLY_CHUNK_MESSAGES));
  }
  return windows.slice(-NIGHTLY_MAX_CHUNKS);
}

const DECAY_QUESTION: ChoiceQuestion<"keep" | "delete"> = {
  instructions:
    "A private memory note about a Discord member has not been updated for a month. " +
    "Should the bot keep it as long-term profile information, or delete it as stale?",
  criteria: {
    keep: "A durable fact: a preference, relationship, plan or ongoing situation that is likely still true and useful.",
    delete: "Small talk or a time-limited detail that no longer matters, such as a momentary mood or a one-off joke.",
  },
};

/** Jev reviews one stale memory. No text is written, so the LLM is not involved. */
async function reviewStaleMemory(
  deps: NightlyDeps,
  memory: Memory,
  now: number,
): Promise<MemoryChange | null> {
  try {
    const result = await deps.jev.choice(
      {
        memory: { id: memory.id, content: memory.content },
        age_days: Math.floor((now - memory.updatedAt) / DAY_MS),
      },
      DECAY_QUESTION,
    );
    if (!result.ok || result.value.choice !== "delete") return null;
    const reason = `Jev: decay delete / ${memory.content.slice(0, 120)}`;
    const deleted = await deps.store.deleteMemory(memory.id, "nightly", reason);
    return deleted ? { action: "delete", recordId: memory.id, reason } : null;
  } catch (err) {
    deps.log(`decay failed for ${memory.id}: ${errorText(err)}`);
    return null;
  }
}

const DIARY_SYSTEM =
  "You keep a one-line diary of a small Discord community. Write in Japanese " +
  "as one plain factual sentence. No preamble, no quotes, no name prefix.";

/** One-line diary of the day. An empty text when the LLM fails (the run still gets recorded). */
async function writeDiary(
  deps: NightlyDeps,
  messages: LoggedMessage[],
  day: string,
): Promise<string> {
  const lines = messages
    .slice(-DIARY_MESSAGES)
    .map((message) => `${message.authorName}: ${message.content}`)
    .join("\n");
  try {
    return (
      await deps.generate([
        { role: "system", content: DIARY_SYSTEM },
        {
          role: "user",
          content: `# Conversation on ${day}\n${lines}\n\nWrite a one-sentence diary entry about what happened that day.`,
        },
      ])
    ).trim();
  } catch (err) {
    deps.log(`diary failed: ${errorText(err)}`);
    return "";
  }
}

function counts(changes: MemoryChange[]): string {
  const count = (action: MemoryChange["action"]) =>
    changes.filter((change) => change.action === action).length;
  return `add=${count("add")} update=${count("update")} delete=${count("delete")}`;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
