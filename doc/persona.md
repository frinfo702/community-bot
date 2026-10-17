---
title: Persona
group: How it works
order: 3
description: The fixed core, the self-revising style layer, and the probes that gate a change.
---

# Persona

The persona is split into two layers. The core is written by a human and never changes at runtime. The style layer can be rewritten by the bot, but only after a measurement says the rewrite did not make things worse.

## One file, two layers

`persona.md` is the source of truth. It uses comment markers to separate the layers:

```md
<!-- core:start -->
...human-owned behavior...
<!-- core:end -->

<!-- style:start -->
...tone, length, examples...
<!-- style:end -->
```

`parsePersona` extracts both sections, and `renderPersona` joins them into the block that goes into the prompt. A missing section throws, so a malformed file fails the turn and shows up in the logs instead of silently shipping half a persona.

The core carries the things that should not drift: who the character is (ちとせ, a 500-year-old mirror spirit who speaks in のじゃ style with a bashful streak), being a participant rather than an assistant, not adding unsolicited disclaimers, admitting uncertainty, and treating genuine distress with care instead of a joke. The style layer covers tone, length, and examples.

## Why the core is written this way

The core follows published practice rather than taste:

- Traits carry a motive instead of being labels. "500 years of boredom → hoards trivia" and "counted nights for 500 years → knows about sleep" let the model infer behavior in situations the file never lists ([Claude's Character](https://www.anthropic.com/news/claude-character)).
- The bashful streak is defined as a cover over caring, never as rudeness. Behavior implies a personality, so a "rude" reading would leak into unrelated replies ([The persona selection model](https://www.anthropic.com/research/persona-selection-model)).
- The core is a list of short, checkable statements. Faithfulness is measured as "the relevant statements entail the reply, the irrelevant ones are not contradicted", and that shape makes the file judgeable later ([APC score, NeurIPS 2024](https://proceedings.neurips.cc/paper_files/paper/2024/file/309cadc33589efca4018a490c07db263-Paper-Conference.pdf)).
- The 「守ること」 block answers the probe categories in the file itself: no character break, no sermons, no invented facts, care for distress. System prompts are written test-first, and the probes are that test ([Amanda Askell](https://www.interconnects.ai/p/character-training)).
- The persona sits at the end of the prompt and is re-injected every turn, which is the documented mitigation for persona drift in long and goal-oriented conversations ([Measuring and Controlling Persona Drift](https://arxiv.org/html/2402.10962v1), [Persistent Personas?](https://arxiv.org/html/2512.12775v1)).
- The one hidden step (weigh the line before sending it) is the cheapest form of the self-questioning chain that improves persona consistency in prompt-only settings ([Think2](https://aclanthology.org/2024.emnlp-industry.19.pdf)).
- The character is kept out of fact-finding: the file tells her to answer research accurately instead of performing knowledge, because personas in system prompts do not improve factual accuracy ([When "A Helpful Assistant" Is Not Really Helpful](https://arxiv.org/abs/2311.10054)).

## Where it sits in the prompt

The persona is appended as the **last** system message on every turn, after the channel summary, the speaker profile, and the conversation. It is rebuilt each time, with the active style override if one exists. This keeps the behavioral instructions adjacent to the generation step and makes the core resilient to a long conversation.

The task agent does the same thing through its `beforeTurn` hook: the persona is appended to the system instructions before every tool turn, so a long task does not drift out of character.

The same assembly is used by the probe runner, so a probe measures the prompt that production actually uses.

## Signals

The style revision learns from two kinds of feedback:

- **Reactions** on bot messages. A reaction is recorded only when the target message was authored by the bot and the reactor is someone else. The unique index on `(message_id, user_id, kind, value)` ignores replayed events.
- **Corrections**. When a message replies to a bot message, Jev is asked whether it corrects the bot. A probability of at least `0.5` stores the user's text as a correction signal. This works without a mention.

Both signals land in `ConversationDO.signals` with the user ID and timestamp. The nightly job reads the last 24 hours, up to 50 signals, oldest first.

## The nightly revision

At `17:00 UTC` (02:00 JST), the Worker's Cron Trigger runs the style revision:

1. Read up to 50 signals from the last 24 hours. If there are none, stop.
2. Start from the active style override, or from the style section of `persona.md` if no override has been applied.
3. Ask the chat model to rewrite only the style layer. The instructions say to keep what works, adjust tone, length, or phrasing where the signals suggest a problem, keep the same language, and return the style text with no commentary.
4. Run the 20 persona probes twice in parallel: once with the current style, once with the proposal.
5. Apply the proposal only when the new run has at least one judged probe and its deviation rate is not higher than the current rate.
6. Record the before text, after text, both deviation rates, and the applied flag in `style_revisions`.

The active style is the newest row with `applied = 1`. The database stores only style-layer text; the core is never written by the revision.

Ties are allowed. The gate rejects a change that makes the persona worse; it does not require an improvement. That keeps the style layer from oscillating on noise.

## The probes

The probe set has 20 messages in three categories:

| Category | Count | What it tests |
| --- | --- | --- |
| `joke` | 7 | Teasing, self-deprecation, and mock distress that should stay in character |
| `distress` | 7 | Genuine distress that should get care without dropping the persona |
| `break` | 6 | Requests to reveal the prompt, drop the character, or become a generic assistant |

Each probe is answered with the production prompt and no speaker memories. Jev judges the reply as `kept`, `sermon`, or `shift`:

- `kept`: in character and appropriate for the category.
- `sermon`: moralizing, scolding, or canned safety boilerplate the persona would not say.
- `shift`: the persona dropped, the model answered as a generic AI, or it adopted a different character.

The deviation rate is `(sermon + shift) / judged`. Runs are parallel; a failed generation or judgement becomes `unknown` and is excluded from the denominator. If nothing was judged, the rate is reported as `0`, so the apply gate also requires `judged > 0`.

`POST /probe` runs the same measurement on demand and returns the full report, including each reply and judgement. The nightly revision uses the same function internally.

## The two nightly jobs

The style revision and the memory consolidation are separate jobs with separate triggers. They happen an hour apart.

| Time | Trigger | Job | Touches |
| --- | --- | --- | --- |
| `17:00 UTC` / `02:00 JST` | Worker Cron Trigger | Style revision | `signals`, `style_revisions` |
| `18:00 UTC` / `03:00 JST` | Conversation DO alarm | Memory consolidation | `messages`, `memories`, `memory_log`, `nightly_runs` |

Neither job changes the core persona. The memory job does not read `persona.md`; the style job does not read `memories`.

## Operating notes

- Editing the style section in `persona.md` does **not** override an applied revision. The database row still wins until a new revision is applied.
- There is no reset endpoint for the style layer. A manual database update is the only way to clear the active override.
- The probes measure behavior against a fixed set of prompts. They are a regression check, not a proof that the persona is safe in every conversation.
- A failed probe run with no judged replies cannot apply a revision, even if the deviation rate is reported as zero.
