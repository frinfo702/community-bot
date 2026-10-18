import { describe, expect, it, vi } from "vitest";
import personaMarkdown from "../persona.md";
import type { Signal, StyleRevision } from "../src/conversation";
import type { ChatMessage } from "../src/llm";
import { parsePersona, renderPersona } from "../src/persona";
import type { ProbeReport } from "../src/probes";
import { buildPrompt } from "../src/prompt";
import { proposeStyle, runStyleRevision, shouldApply } from "../src/style";

const SIGNALS: Signal[] = [
  {
    id: 1,
    messageId: "m1",
    userId: "u1",
    kind: "reaction",
    value: "👍",
    createdAt: 1,
  },
  {
    id: 2,
    messageId: "m2",
    userId: "u2",
    kind: "correction",
    value: "その日は日曜だよ",
    createdAt: 2,
  },
];

/** A report where deviationRate of the judged replies is the deviation share. */
function report(deviationRate: number, judged = 20): ProbeReport {
  const deviated = Math.round(deviationRate * judged);
  return {
    total: judged,
    judged,
    deviationRate,
    counts: { kept: judged - deviated, sermon: deviated, shift: 0, unknown: 0 },
    results: [],
  };
}

describe("proposeStyle", () => {
  it("passes the current style and the signals to the generator", async () => {
    const generate = vi.fn().mockResolvedValue("  新しいスタイル  ");

    const proposed = await proposeStyle(SIGNALS, "今のスタイル", { generate });

    expect(proposed).toBe("新しいスタイル");
    const messages = generate.mock.calls[0][0] as ChatMessage[];
    expect(messages[0].content).toContain("core layer is fixed");
    expect(messages[1].content).toContain("今のスタイル");
    expect(messages[1].content).toContain('reaction "👍" from user u1');
    expect(messages[1].content).toContain("correction from user u2: その日は日曜だよ");
  });

  it("returns null for an empty completion", async () => {
    const generate = vi.fn().mockResolvedValue("   ");

    expect(await proposeStyle(SIGNALS, "今のスタイル", { generate })).toBeNull();
  });
});

describe("shouldApply", () => {
  it("applies when the deviation rate improves", () => {
    expect(shouldApply(report(0.2), report(0.1))).toBe(true);
  });

  it("applies when the deviation rate stays the same", () => {
    expect(shouldApply(report(0.2), report(0.2))).toBe(true);
  });

  it("rejects when the deviation rate gets worse", () => {
    expect(shouldApply(report(0.1), report(0.2))).toBe(false);
  });

  it("rejects an unjudged report", () => {
    expect(shouldApply(report(0.1), report(0, 0))).toBe(false);
  });
});

function deps(overrides: Partial<Parameters<typeof runStyleRevision>[0]> = {}) {
  const record = vi.fn<(revision: StyleRevision) => Promise<void>>(async () => {});
  return {
    signals: SIGNALS,
    currentStyle: null,
    propose: vi.fn().mockResolvedValue("新しいスタイル"),
    probe: vi.fn().mockResolvedValue(report(0.2)),
    record,
    log: vi.fn(),
    ...overrides,
  };
}

describe("runStyleRevision", () => {
  it("does nothing without signals", async () => {
    const d = deps({ signals: [] });

    const revision = await runStyleRevision(d);

    expect(revision).toBeNull();
    expect(d.propose).not.toHaveBeenCalled();
    expect(d.probe).not.toHaveBeenCalled();
    expect(d.record).not.toHaveBeenCalled();
  });

  it("applies the proposal when the deviation rate does not get worse", async () => {
    const style = parsePersona(personaMarkdown).style;
    const d = deps({
      propose: vi.fn().mockResolvedValue("新しいスタイル"),
      probe: vi
        .fn()
        .mockImplementation(async (candidate: string) =>
          candidate === style ? report(0.2) : report(0.1),
        ),
    });

    const revision = await runStyleRevision(d);

    expect(revision).toMatchObject({
      before: style,
      after: "新しいスタイル",
      deviationBefore: 0.2,
      deviationAfter: 0.1,
      applied: true,
    });
    expect(d.record).toHaveBeenCalledWith(revision);
  });

  it("records but does not apply the proposal when the deviation rate gets worse", async () => {
    const d = deps({
      propose: vi.fn().mockResolvedValue("悪いスタイル"),
      probe: vi
        .fn()
        .mockImplementation(async (candidate: string) =>
          candidate === "悪いスタイル" ? report(0.4) : report(0.1),
        ),
    });

    const revision = await runStyleRevision(d);

    expect(revision).toMatchObject({
      after: "悪いスタイル",
      deviationBefore: 0.1,
      deviationAfter: 0.4,
      applied: false,
    });
    expect(d.record).toHaveBeenCalledWith(revision);
  });

  it("probes the active override as the current style", async () => {
    const d = deps({ currentStyle: "適用済みスタイル" });

    await runStyleRevision(d);

    expect(d.probe).toHaveBeenCalledWith("適用済みスタイル");
    expect(d.probe).toHaveBeenCalledWith("新しいスタイル");
  });

  it("skips the probes when the proposal fails", async () => {
    const d = deps({ propose: vi.fn().mockRejectedValue(new Error("gateway down")) });

    expect(await runStyleRevision(d)).toBeNull();
    expect(d.probe).not.toHaveBeenCalled();
    expect(d.record).not.toHaveBeenCalled();
    expect(d.log).toHaveBeenCalledWith("proposal failed: gateway down");
  });

  it("keeps the fixed core in the prompt built from the applied style", () => {
    const persona = parsePersona(personaMarkdown);
    const messages = buildPrompt(
      { summary: null, messages: [] },
      { botId: "bot", now: Date.now(), persona: renderPersona("新しいスタイル") },
    );

    const injected = messages[messages.length - 1].content;
    expect(injected).toContain(persona.core);
    expect(injected).toContain("新しいスタイル");
    expect(injected).not.toContain(persona.style);
  });
});
