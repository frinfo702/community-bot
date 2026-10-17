---
title: A Discord member that remembers.
nav: Overview
group: Start
order: 1
description: What community-bot is, the three loops it runs, and how the pieces fit together.
---

# A Discord member that remembers.

community-bot is an AI member of a four-person Discord server. It answers in the form the moment calls for, keeps a private memory of each person, and revises its own manners at night. Everything runs on Cloudflare, so there is no machine to keep alive.

<figure class="diagram">
<div data-diagram="anatomy"></div>
<div class="diagram-mobile">
  <ol class="map-stack">
    <li><span class="map-name">Discord</span><span class="map-sub">a member types</span></li>
    <li><span class="map-name">Gateway DO</span><span class="map-sub">one WebSocket</span></li>
    <li><span class="map-name">Worker</span><span class="map-sub">routes the event</span></li>
    <li><span class="map-name">Conversation DO</span><span class="map-sub">SQLite, memories</span></li>
  </ol>
  <div class="map-branch">
    <p>Worker also calls</p>
    <div><span>AI Gateway</span><span>Jev</span><span>TaskAgent</span></div>
  </div>
  <p class="map-clock">Cron 17:00 UTC<br>alarm 03:00 JST</p>
</div>
<figcaption><strong>Fig. 1.</strong> The bot, exploded. A message enters through a Durable Object, is routed by a Worker, and lands in another Durable Object that holds the conversation and its memories. Model calls and the task agent hang off the same Worker.</figcaption>
</figure>

## What it does

It is not an assistant waiting for a prompt. It sits in the channel, follows the conversation, and joins when someone mentions it. A reply can be a single emoji, a short paragraph, or a multi-step task such as researching a question with web tools and a sandbox. A typed decision model picks the shape of the reply before any text is written, and the reaction is sent first as an immediate acknowledgment.

The bot also remembers. Each person has their own memories, written after a conversation and consolidated while the server sleeps. Memories are injected into the next reply as context, never as facts about the channel as a whole.

## Three loops

The system is easier to hold in your head as three loops that run at different speeds.

1. **The turn.** A message is de-duplicated, appended to the channel log, and classified. If the bot was mentioned, it reacts first, then either answers in text or hands the request to the task agent. A memory extraction runs after the reply, outside the response path.
2. **The style.** At `17:00 UTC` a Cron Trigger reads the last day of reactions and corrections, proposes a new style layer, and keeps it only if the persona probes do not get worse.
3. **The memory.** At `03:00 JST` a Durable Object alarm groups the previous day by speaker, merges what is worth keeping, reviews memories that have gone stale, and writes a one-line diary of the day.

The two nightly jobs are deliberately separate. Style revision uses a Cron Trigger because it is a Worker-level job. Memory consolidation uses a Durable Object alarm because it needs the same SQLite database as the messages it reads.

## Design choices

- **Decisions are typed; text is generated.** Jev returns a choice, a probability, or a score. The language model only writes text for a decision that has already been made.
- **One Durable Object owns the log and the memories.** Both daily extraction and nightly consolidation touch the same rows, so they share a transaction boundary instead of coordinating across services.
- **Every memory write leaves a ledger entry.** The `memory_log` table stores the before and after state, the actor, and the reason. A nightly run can be rolled back from it.
- **The core persona is human-owned.** Only the style layer can revise itself, and only when the probes say the change is safe.
- **A failed decision never destroys data.** If Jev cannot answer, the bot falls back to a written reply, a default reaction, or leaves the memory untouched.

## Start here

- [Architecture](architecture.md): the runtime pieces and what each one owns.
- [Agent workflow](agent-workflow.md): what happens between a mention and a reply.
- [Memory](memory.md): how memories are written, read, consolidated, and rolled back.
- [Commands](commands.md): what you can type in the server.
- [Deploy and operate](operations.md): local setup, deployment, and the docs pipeline.
