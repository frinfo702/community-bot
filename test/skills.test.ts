import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { botchDocBody, skillFiles } from "../src/skill-files";

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

  // The loader parses the frontmatter as YAML: an unquoted ": " in a value, for
  // example, makes it a nested mapping and the skill is dropped from the catalog.
  it("parses as a YAML mapping", () => {
    const block = raw.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
    expect(parse(block)).toMatchObject({
      name: expect.any(String),
      description: expect.any(String),
    });
  });
});

// Anything the summary does not cover is answered by the user-facing docs site.
describe("skills/botch-doc/SKILL.md", () => {
  it("points to the docs site", () => {
    expect(botchDocBody).toContain("https://botch-docs.kenichirog.com/");
  });
});
