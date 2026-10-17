import capabilities from "../skills/capabilities/SKILL.md";
import sandbox from "../skills/sandbox/SKILL.md";

/**
 * The bundled SKILL.md files as text. Adding a skill under skills/ also needs a
 * line here (the sandbox image copies the whole directory, so it needs none).
 * Separate from skills.ts, which builds the Think manifest, so tests can read
 * the list without loading the agents runtime.
 */
export const skillFiles = [capabilities, sandbox];
