import personaMarkdown from "../persona.md";
import type { Signal, StyleRevision } from "./conversation";
import type { ChatMessage } from "./llm";
import { parsePersona } from "./persona";
import type { ProbeReport } from "./probes";

const STYLE_INSTRUCTIONS = [
  "You maintain the style layer of a Discord bot's persona. The core layer is fixed and must not be touched.",
  "Rewrite only the style layer from the signals below: keep what works, and adjust tone, length or phrasing where the signals suggest a problem.",
  "Keep the same language as the current style. Reply with the new style layer text only, no commentary, no markdown fences.",
].join("\n");

/** 改訂の材料にするシグナル一覧。 */
export function styleRevisionState(
  signals: Signal[],
  currentStyle: string,
): string {
  const lines = signals.map((signal) =>
    signal.kind === "reaction"
      ? `- reaction "${signal.value}" from user ${signal.userId}`
      : `- correction from user ${signal.userId}: ${signal.value}`,
  );
  return `Current style layer:\n${currentStyle}\n\nSignals (oldest first):\n${lines.join("\n")}`;
}

export interface ProposeStyleOptions {
  generate(messages: ChatMessage[]): Promise<string>;
}

/** シグナルからスタイル層だけの改訂案を作る。空応答なら null。 */
export async function proposeStyle(
  signals: Signal[],
  currentStyle: string,
  options: ProposeStyleOptions,
): Promise<string | null> {
  const text = (
    await options.generate([
      { role: "system", content: STYLE_INSTRUCTIONS },
      { role: "user", content: styleRevisionState(signals, currentStyle) },
    ])
  ).trim();
  return text || null;
}

/** 改訂案を適用してよいか。採点できていて、逸脱率が悪化していないときだけ。 */
export function shouldApply(before: ProbeReport, after: ProbeReport): boolean {
  return after.judged > 0 && after.deviationRate <= before.deviationRate;
}

export interface StyleRevisionDeps {
  signals: Signal[];
  /** 有効なオーバーライド。無ければ persona.md の style から始める */
  currentStyle: string | null;
  propose(signals: Signal[], currentStyle: string): Promise<string | null>;
  probe(style: string): Promise<ProbeReport>;
  record(revision: StyleRevision): Promise<void>;
  log(message: string): void;
}

/**
 * 夜間のスタイル改訂。シグナルが無ければ何もしない。改訂案はプローブで逸脱率が
 * 悪化しないときだけ適用し、before / after と逸脱率つきで DO に記録する。
 */
export async function runStyleRevision(
  deps: StyleRevisionDeps,
): Promise<StyleRevision | null> {
  if (deps.signals.length === 0) {
    deps.log("no signals; skipped");
    return null;
  }

  const current = deps.currentStyle ?? parsePersona(personaMarkdown).style;
  let proposed: string | null = null;
  try {
    proposed = await deps.propose(deps.signals, current);
  } catch (err) {
    deps.log(
      `proposal failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!proposed) return null;

  const [before, after] = await Promise.all([
    deps.probe(current),
    deps.probe(proposed),
  ]);
  const revision: StyleRevision = {
    before: current,
    after: proposed,
    deviationBefore: before.deviationRate,
    deviationAfter: after.deviationRate,
    applied: shouldApply(before, after),
    createdAt: Date.now(),
  };
  await deps.record(revision);
  deps.log(
    `signals=${deps.signals.length} applied=${revision.applied}` +
      ` deviation=${revision.deviationBefore}->${revision.deviationAfter}` +
      `\nbefore: ${revision.before}\nafter: ${revision.after}`,
  );
  return revision;
}
