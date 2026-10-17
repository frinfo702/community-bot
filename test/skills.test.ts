import { describe, expect, it } from "vitest";
import { skillFiles } from "../src/skill-files";

const skills = skillFiles.map((raw) => ({
  name: raw.match(/^name: (\S+)$/m)?.[1] ?? "(no name)",
  raw,
}));

// Think's loader silently drops a SKILL.md whose frontmatter has no name or description.
describe.each(skills)("skills/$name/SKILL.md", ({ raw }) => {
  it("has name and description frontmatter", () => {
    expect(raw).toMatch(/^---\n/);
    expect(raw).toMatch(/^name: \S+$/m);
    expect(raw).toMatch(/^description: \S+/m);
  });
});
