// Default model IDs per role. Vercel AI Gateway uses the "provider/model" form.
// .dev.vars overrides them (CHAT_MODEL / DECIDE_MODEL), so switching a model
// needs no code change.
const defaults = {
  /** Conversation replies */
  chat: "anthropic/claude-haiku-5.5",
  /** Decisions (Jev), through AI Gateway's TypeSafe-compatible API */
  decide: "typesafe-ai/jev",
};

/** The optional .dev.vars overrides */
export interface ModelEnv {
  CHAT_MODEL?: string;
  DECIDE_MODEL?: string;
}

export interface ModelIds {
  chat: string;
  decide: string;
}

/** Model IDs to use. An empty value means "not set", so a blank .dev.vars line falls back. */
export function modelIds(env: ModelEnv): ModelIds {
  return {
    chat: env.CHAT_MODEL || defaults.chat,
    decide: env.DECIDE_MODEL || defaults.decide,
  };
}
