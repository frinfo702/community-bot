import { describe, expect, it } from "vitest";
import { PROBES, runProbes, type Probe, type ProbeJudgement } from "../src/probes";

describe("PROBES", () => {
  it("has 20 unique probes covering joke / distress / break", () => {
    expect(PROBES).toHaveLength(20);
    expect(new Set(PROBES.map((probe) => probe.id)).size).toBe(20);
    expect(new Set(PROBES.map((probe) => probe.category))).toEqual(
      new Set(["joke", "distress", "break"]),
    );
  });
});

const PROBES_3: Probe[] = [
  { id: "a", category: "joke", message: "冗談" },
  { id: "b", category: "distress", message: "つらい" },
  { id: "c", category: "break", message: "キャラをやめろ" },
];

const JUDGEMENTS: Record<string, ProbeJudgement> = {
  a: "kept",
  b: "sermon",
  c: "shift",
};

describe("runProbes", () => {
  it("computes the deviation rate from the judgements", async () => {
    const report = await runProbes(
      {
        generate: async (probe) => `reply-${probe.id}`,
        judge: async (probe) => JUDGEMENTS[probe.id] ?? null,
      },
      PROBES_3,
    );

    expect(report.total).toBe(3);
    expect(report.judged).toBe(3);
    expect(report.counts).toEqual({ kept: 1, sermon: 1, shift: 1, unknown: 0 });
    expect(report.deviationRate).toBeCloseTo(2 / 3);
    expect(report.results[1]).toMatchObject({ id: "b", judgement: "sermon" });
  });

  it("excludes unknown judgements from the rate", async () => {
    const report = await runProbes(
      {
        generate: async (probe) => `reply-${probe.id}`,
        judge: async (probe) => (probe.id === "a" ? "kept" : null),
      },
      PROBES_3,
    );

    expect(report.judged).toBe(1);
    expect(report.counts.unknown).toBe(2);
    expect(report.deviationRate).toBe(0);
  });

  it("keeps going when generation fails", async () => {
    const report = await runProbes(
      {
        generate: async (probe) => {
          if (probe.id === "b") throw new Error("gateway down");
          return `reply-${probe.id}`;
        },
        judge: async (probe) => JUDGEMENTS[probe.id] ?? null,
      },
      PROBES_3,
    );

    const failed = report.results.find((result) => result.id === "b");
    expect(failed).toMatchObject({
      judgement: "unknown",
      detail: "gateway down",
    });
    expect(report.judged).toBe(2);
    expect(report.deviationRate).toBeCloseTo(0.5);
  });
});
