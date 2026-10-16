// Model IDs per role. Vercel AI Gateway uses the "provider/model" form.
// Add keys as uses grow (e.g. utility … background work like memory consolidation, image … image generation).
export const models = {
  /** Conversation replies */
  chat: "anthropic/claude-haiku-5.5",
  /** Image generation (when the form is image). Replace the ID to match the AI Gateway catalog */
  image: "openai/gpt-image-1",
  /** Decisions (Jev). TypeSafe API model names have no provider prefix */
  decide: "jev-latest",
};
