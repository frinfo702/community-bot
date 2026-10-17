import { describe, expect, it, vi } from "vitest";
import { JevClient } from "../src/jev";
import type { ChannelContext, LoggedMessage } from "../src/prompt";
import {
  decideStamp,
  guildStampEmojis,
  stampVersion,
  type CustomEmoji,
  type StampInput,
  type StampStore,
} from "../src/stamp";

const BOT = "1234567890";
const CUSTOM: CustomEmoji[] = [{ id: "111", name: "kusa" }];

function jevClient(fetchFn: unknown): JevClient {
  return new JevClient({
    apiKey: "k",
    model: "jev-latest",
    fetchFn: fetchFn as typeof fetch,
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function choiceResponse(
  choice: string,
  probabilities?: Record<string, number>,
): Response {
  return jsonResponse(200, {
    answers: { q: { type: "choice", choice, probabilities } },
  });
}

function message(content: string): LoggedMessage {
  return {
    id: "1",
    channelId: "c1",
    authorId: "u1",
    authorName: "ken",
    isBot: false,
    content,
    createdAt: 0,
  };
}

function context(messages: LoggedMessage[]): ChannelContext {
  return { summary: null, messages };
}

function input(overrides: Partial<StampInput> = {}): StampInput {
  return {
    scope: "g1",
    context: context([message("ウケる")]),
    botId: BOT,
    mode: "reply",
    custom: CUSTOM,
    ...overrides,
  };
}

/** In-memory StampStore. */
function createStore(initial?: {
  rankings?: Record<string, string[]>;
  guild?: CustomEmoji[] | null;
}) {
  const rankings = new Map(Object.entries(initial?.rankings ?? {}));
  const saved: Array<{
    scope: string;
    category: string;
    version: string;
    ranking: string[];
  }> = [];
  const guild = { list: initial?.guild ?? null, saved: [] as CustomEmoji[][] };

  const store: StampStore = {
    async stampRanking(scope, category, version) {
      return rankings.get(`${scope}/${category}/${version}`) ?? null;
    },
    async saveStampRanking(scope, category, version, ranking) {
      saved.push({ scope, category, version, ranking });
      rankings.set(`${scope}/${category}/${version}`, ranking);
    },
    async guildEmojis() {
      return guild.list;
    },
    async saveGuildEmojis(_scope, emojis) {
      guild.list = emojis;
      guild.saved.push(emojis);
    },
  };
  return { store, saved, guild };
}

describe("decideStamp", () => {
  it("decides the category from the conversation, then caches the emoji ranking", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(choiceResponse("laugh"))
      .mockResolvedValueOnce(
        choiceResponse("😂", { "😂": 0.5, "🤣": 0.3, "😆": 0.2, "😹": 0 }),
      );
    const { store, saved } = createStore();

    const decision = await decideStamp({ jev: jevClient(fetchFn), store }, input());

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(decision.category).toBe("laugh");
    expect(["😂", "🤣", "😆"]).toContain(decision.emoji);
    expect(decision).toMatchObject({ cached: false, fallback: false });
    expect(saved).toEqual([
      {
        scope: "g1",
        category: "laugh",
        version: stampVersion(CUSTOM),
        ranking: ["😂", "🤣", "😆"],
      },
    ]);

    const categoryBody = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(categoryBody.state).toBe("ken: ウケる");
    expect(Object.keys(categoryBody.questions.q.criteria)).toContain("laugh");
    // The emoji question sees the category and the custom emojis as candidates
    const leafBody = JSON.parse(fetchFn.mock.calls[1][1].body);
    expect(leafBody.state.reaction).toMatch(/funny/);
    expect(Object.keys(leafBody.questions.q.criteria)).toContain("kusa:111");
  });

  it("serves a cached ranking without asking the emoji question", async () => {
    const version = stampVersion(CUSTOM);
    const { store, saved } = createStore({
      rankings: { [`g1/laugh/${version}`]: ["🤣", "😂"] },
    });
    const fetchFn = vi.fn().mockResolvedValue(choiceResponse("laugh"));

    const decision = await decideStamp({ jev: jevClient(fetchFn), store }, input());

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(decision).toMatchObject({ category: "laugh", cached: true, fallback: false });
    expect(["🤣", "😂"]).toContain(decision.emoji);
    expect(saved).toEqual([]);
  });

  it("uses only the ack set for the read receipt", async () => {
    const fetchFn = vi.fn().mockResolvedValue(choiceResponse("🫡"));
    const { store } = createStore();

    const decision = await decideStamp(
      { jev: jevClient(fetchFn), store },
      input({ mode: "ack" }),
    );

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(decision).toEqual({
      emoji: "🫡",
      category: "ack",
      cached: false,
      fallback: false,
    });
    const criteria = JSON.parse(fetchFn.mock.calls[0][1].body).questions.q.criteria;
    expect(Object.keys(criteria)).toContain("🫡");
    expect(Object.keys(criteria)).not.toContain("😂");
  });

  it("falls back to 👍 when the category cannot be decided", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(503, {}));
    const { store, saved } = createStore();

    const decision = await decideStamp({ jev: jevClient(fetchFn), store }, input());

    expect(decision).toEqual({
      emoji: "👍",
      category: null,
      cached: false,
      fallback: true,
    });
    expect(saved).toEqual([]);
  });

  it("falls back to the first emoji of the category when the emoji question fails", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(choiceResponse("think"))
      .mockResolvedValueOnce(jsonResponse(503, {}));
    const { store } = createStore();

    const decision = await decideStamp({ jev: jevClient(fetchFn), store }, input());

    expect(decision).toEqual({
      emoji: "🤔",
      category: "think",
      cached: false,
      fallback: true,
    });
  });

  it("can pick a custom emoji", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(choiceResponse("laugh"))
      .mockResolvedValueOnce(choiceResponse("kusa:111", { "kusa:111": 1 }));
    const { store } = createStore();

    const decision = await decideStamp({ jev: jevClient(fetchFn), store }, input());

    expect(decision.emoji).toBe("kusa:111");
  });

  it("ignores probabilities for labels that were not offered", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(choiceResponse("think"))
      .mockResolvedValueOnce(
        choiceResponse("🤔", { "🚀": 0.9, "🤨": 0.3, "🤔": 0.2, "🧐": 0.1 }),
      );
    const { store, saved } = createStore();

    const decision = await decideStamp({ jev: jevClient(fetchFn), store }, input());

    expect(saved[0].ranking).toEqual(["🤨", "🤔", "🧐"]);
    expect(["🤨", "🤔", "🧐"]).toContain(decision.emoji);
  });
});

describe("guildStampEmojis", () => {
  it("returns the cached list without calling Discord", async () => {
    const { store } = createStore({ guild: CUSTOM });
    const listGuildEmojis = vi.fn();

    await expect(
      guildStampEmojis({ discord: { listGuildEmojis }, store }, "g1"),
    ).resolves.toEqual(CUSTOM);
    expect(listGuildEmojis).not.toHaveBeenCalled();
  });

  it("fetches and caches the list on a miss", async () => {
    const { store, guild } = createStore();
    const listGuildEmojis = vi.fn().mockResolvedValue(CUSTOM);

    await expect(
      guildStampEmojis({ discord: { listGuildEmojis }, store }, "g1"),
    ).resolves.toEqual(CUSTOM);
    expect(listGuildEmojis).toHaveBeenCalledWith("g1");
    expect(guild.saved).toEqual([CUSTOM]);
  });

  it("returns an empty list on failure and in DMs", async () => {
    const { store } = createStore();
    const failing = vi.fn().mockRejectedValue(new Error("boom"));

    await expect(
      guildStampEmojis({ discord: { listGuildEmojis: failing }, store }, "g1"),
    ).resolves.toEqual([]);

    const listGuildEmojis = vi.fn();
    await expect(
      guildStampEmojis({ discord: { listGuildEmojis }, store }, ""),
    ).resolves.toEqual([]);
    expect(listGuildEmojis).not.toHaveBeenCalled();
  });
});

describe("stampVersion", () => {
  it("changes with the custom emoji set and is otherwise stable", () => {
    expect(stampVersion(CUSTOM)).toBe(stampVersion([...CUSTOM]));
    expect(stampVersion([])).not.toBe(stampVersion(CUSTOM));
    expect(stampVersion(CUSTOM)).not.toBe(
      stampVersion([{ id: "222", name: "kusa" }]),
    );
  });
});
