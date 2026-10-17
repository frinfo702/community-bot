---
title: Memory
group: How it works
order: 2
description: How the bot writes, reads, consolidates, and rolls back what it knows about each person.
---

# Memory

Memory is per person, not per channel. Each row in `memories` belongs to one Discord user, and the reply prompt receives only the memories of the person who triggered the turn. The channel log is shared; the profile is not.

## What is stored

A memory is a short natural-language fact: a preference, a relationship, an ongoing situation, or a plan. It is not a transcript and it is not a summary of the channel. The bot writes one only when a decision model says the exchange is worth keeping.

Every memory has an `id`, an owner (`user_id`), the text, and `created_at` / `updated_at` timestamps. The `updated_at` column is what the nightly decay pass reads: a record that has not been touched for 30 days becomes a candidate for review.

## The write path

Extraction runs after the reply, in `ctx.waitUntil`, so the user never waits for it.

1. **Render the exchange.** The last six messages are formatted with speaker names, including the triggering message and the bot's reply. If there is no usable exchange, nothing happens.
2. **Ask if it is worth keeping.** Jev returns a probability. Below `0.5`, the run ends with no reads and no writes.
3. **Read the existing memories.** Up to ten of the speaker's memories are loaded, most recently updated first. The read itself is recorded in `memory_log` with the actor `extraction`.
4. **Ask for a verdict on each record.** Jev answers `keep`, `update`, or `delete` for each memory. A record whose verdict call fails is left untouched.
5. **Decide whether to add.** If there are no memories, an add is allowed. Otherwise Jev sees the existing verdicts and returns a probability for adding something new.
6. **Write the text.** For an add and for every `update` verdict, the chat model writes the new memory text. It sees only the exchange and the record being rewritten, not the whole profile.
7. **Apply and log.** Deletes, updates, and the add are applied through `ConversationDO`. Each change gets a `memory_log` row with the actor, the reason, and the before / after state.

The split matters: Jev decides *whether* and *which record*; the language model only decides *how to phrase it*. If Jev is unavailable, no memory is written.

## The read path

There are two readers.

- **The reply prompt** loads up to ten memories for the speaker, ordered by `updated_at`, and injects them as one system message before the conversation. This read is logged with actor `reply`.
- **`!memory show`** loads up to ten memories with actor `command`, formats each as its id plus the first 80 characters, and sends the list by DM. See [Commands](commands.md).

A read is a ledger event too. `memory_log` is an audit trail of who looked at a profile as well as who changed it.

## Nightly consolidation

At `03:00 JST`, a Durable Object alarm runs the consolidation for the previous 24 hours.

- Only non-bot messages are considered. The channel log itself keeps both sides of the conversation.
- Messages are grouped by speaker, then split into chunks of six. Only the newest five chunks per speaker are used, which bounds the number of Jev and model calls on a very active day.
- Each chunk goes through the same extraction path with the actor `nightly`. A failure for one speaker is logged and does not stop the others.
- Memories that have not been updated in 30 days are reviewed, oldest first, up to 20 per night. Jev answers `keep` or `delete`. A kept record stays in the stale set and is reviewed again the next night.
- Finally, the chat model writes a one-line diary from the last 30 messages. The diary is written in Japanese, matching the server's conversation.
- The run is stored in `nightly_runs` with the JST day label, the diary, a JSON summary of changes, and the start and finish timestamps.

The nightly run is bounded by design: five chunks per speaker, twenty stale reviews, and one diary call. The caps are the cost control, not a time-based stop.

## Decay

A memory is not a log. If a note has gone a month without being updated, Jev is asked whether it is still durable profile information or a time-limited detail that no longer matters. Only an explicit `delete` removes it. A failed or ambiguous call keeps it.

Decay is part of the nightly run and is recorded in the same run summary. The `decayed` array lists the record IDs removed by the decay pass, separate from the extraction changes.

## Rollback

The nightly run is reversible because every change carries its before and after state.

`POST /memory/rollback` with no body undoes the latest run; `{ "runId": 12 }` targets a specific one. The endpoint is protected by the admin secret.

The rollback walks the run's `memory_log` rows newest-first and replays them in reverse:

- An `add` is deleted, but only if the current content still matches what the run wrote.
- An `update` is restored to its previous content, under the same condition.
- A `delete` is reinserted from the stored before state, but only if the ID is still absent.

A record that changed again after the run is skipped. That protects a later extraction or a user's `!memory forget` from being overwritten by an old rollback. The rollback itself is logged with action `rollback` and actor `nightly`, and the run is marked as rolled back. Repeating the request returns `409` with `alreadyRolledBack: true`.

## Invariants

- **One owner per memory.** Reads and writes are scoped by `user_id`; a command can never delete another person's record.
- **No decision, no write.** A failed or low-confidence Jev answer leaves the existing rows untouched.
- **Every change is logged.** Reads, adds, updates, deletes, and rollbacks all land in `memory_log`.
- **Nightly work is bounded.** Chunk caps and stale-review caps keep a busy day from turning into unbounded model calls.
- **Deletion is real.** `!memory forget` removes the row. The ledger keeps the before state for audit and rollback, but the active profile no longer contains it.

## Privacy

`!memory show` sends the list to the author's DM. If the bot cannot open a DM, it says so in the channel without repeating the memories. The reply path never mixes one speaker's memories into another speaker's prompt.

The `memory_log` table does contain memory text in its before / after JSON. It is part of the bot's SQLite database, not exposed through an HTTP endpoint; only the rollback endpoint reads it, and that endpoint is admin-only.

Messages and memories have no automatic expiry. The only retention job is the seven-day de-duplication ledger.
