import personaMarkdown from "../persona.md";

const CORE = /<!--\s*core:start\s*-->([\s\S]*?)<!--\s*core:end\s*-->/;
const STYLE = /<!--\s*style:start\s*-->([\s\S]*?)<!--\s*style:end\s*-->/;

export interface Persona {
  core: string;
  style: string;
}

/** Split persona.md into the fixed core and the style layer. Throws so a missing section is noticed at startup. */
export function parsePersona(markdown: string): Persona {
  const core = markdown.match(CORE)?.[1]?.trim();
  const style = markdown.match(STYLE)?.[1]?.trim();
  if (!core || !style) {
    throw new Error("persona.md に core / style のセクションがない");
  }
  return { core, style };
}

/**
 * The persona block re-injected at the end of the prompt. Only the repository's persona.md is the
 * source of truth for the core; only the style layer can be replaced (self-improvement passes
 * styleOverride in ISSUE-1867).
 */
export function renderPersona(styleOverride?: string): string {
  const persona = parsePersona(personaMarkdown);
  return `${persona.core}\n\n${styleOverride ?? persona.style}`;
}
