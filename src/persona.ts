import personaMarkdown from "../persona.md";

const CORE = /<!--\s*core:start\s*-->([\s\S]*?)<!--\s*core:end\s*-->/;
const STYLE = /<!--\s*style:start\s*-->([\s\S]*?)<!--\s*style:end\s*-->/;

export interface Persona {
  core: string;
  style: string;
}

/** persona.md を固定コアとスタイル層に分ける。欠けていたら起動時に気づけるよう例外にする。 */
export function parsePersona(markdown: string): Persona {
  const core = markdown.match(CORE)?.[1]?.trim();
  const style = markdown.match(STYLE)?.[1]?.trim();
  if (!core || !style) {
    throw new Error("persona.md に core / style のセクションがない");
  }
  return { core, style };
}

/**
 * プロンプト末尾に再注入する人格ブロック。コアはリポジトリの persona.md だけが正で、
 * 差し替えられるのはスタイル層だけ（自己改善は ISSUE-1867 が styleOverride で入れる）。
 */
export function renderPersona(styleOverride?: string): string {
  const persona = parsePersona(personaMarkdown);
  return `${persona.core}\n\n${styleOverride ?? persona.style}`;
}
