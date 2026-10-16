import { describe, expect, it } from "vitest";
import personaMarkdown from "../persona.md";
import { parsePersona, renderPersona } from "../src/persona";

describe("persona", () => {
  it("splits persona.md into the fixed core and the style layer", () => {
    const persona = parsePersona(personaMarkdown);

    expect(persona.core.length).toBeGreaterThan(0);
    expect(persona.style.length).toBeGreaterThan(0);
  });

  it("rejects a file without the markers", () => {
    expect(() => parsePersona("ただのメモ")).toThrow();
  });

  it("renders the core before the style", () => {
    const persona = parsePersona(personaMarkdown);
    const text = renderPersona();

    expect(text.indexOf(persona.core)).toBe(0);
    expect(text.indexOf(persona.style)).toBeGreaterThan(
      text.indexOf(persona.core),
    );
  });

  it("keeps the core when only the style is overridden", () => {
    const persona = parsePersona(personaMarkdown);
    const text = renderPersona("新しい口調の指示");

    expect(text).toContain(persona.core);
    expect(text).toContain("新しい口調の指示");
    expect(text).not.toContain(persona.style);
  });
});
