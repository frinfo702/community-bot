---
title: Commands
group: Reference
order: 1
description: The slash and text commands available in Discord, what they return, and who can see the output.
---

# Commands

The bot accepts a small set of commands. They are handled before the reply pipeline, never call the language model, and only ever answer the caller.

## Command reference

| Command | What it does |
| --- | --- |
| `/memory show` | Shows your memories. At most ten, newest first. |
| `/memory forget id:<id>` | Deletes one memory owned by you. |
| `/memory forget id:all` | Deletes every memory owned by you. |
| `/memory` | Prints the command help. |
| `/cafe` | Opens the 八代カフェ Activity in Discord. |

The definitions live in `src/commands.ts` and are registered with Discord from the Worker: `POST /commands/register` (admin secret) sends them with `PUT /applications/{id}/commands`, which replaces the whole global list, so the endpoint is safe to call again after a deploy.

`/cafe` answers with `LAUNCH_ACTIVITY` (callback type 12), so Discord opens the Activity iframe itself instead of posting a message. The scene is a separate static Worker; see `docs/discord-setup.md` for the portal steps.

## Where the output goes

Discord sends slash commands straight to the Worker, not through the Gateway, and every reply is **ephemeral**: only the member who ran the command sees the command, the reply, and any loading state. Nothing is posted to the channel.

The list format is one line per memory: the id in backticks, then the first 80 characters of the content. When the limit is reached, the message notes that only the newest ten are shown.

## Text commands

The same operations exist as text commands, for people who prefer typing.

| Command | What it does |
| --- | --- |
| `!memory show` | The same list, sent by DM |
| `!memory forget <id>` | Deletes one memory owned by you |
| `!memory forget all` | Deletes every memory owned by you |
| `!memory` | Prints the command help |

The mention form works too:

```text
@community-bot memory show
@community-bot memory forget 3f1c...
```

The leading `!` is not required when the bot is mentioned. A bare `memory show` without a mention is treated as normal conversation.

A text command cannot be ephemeral, so `show` opens or reuses a DM channel with the author and posts the list there, and in a server it replies to the original message with a short confirmation. If the DM cannot be opened, the bot says so in the channel without repeating the memories. In a direct message there is no confirmation; the list is the only response.

## Ownership

`forget` is scoped to the caller. The lookup returns one of three outcomes:

- `deleted`: the record existed and belonged to the caller.
- `not_found`: no record with that id.
- `not_owner`: the record exists but belongs to someone else.

Only the first outcome removes a row. `forget all` deletes the caller's records one by one so every delete gets its own `memory_log` entry with actor `command`.

## What commands do not do

- They do not mention the model, Jev, or the sandbox.
- They do not bypass the log. A `show` records a read event; a `forget` records a delete with the actor and reason.
- The text form leaves a message in the channel. That message says `!memory ...`, so anyone watching can see that a memory command ran, even though the memories themselves stay private. Use the slash form when that matters.

The command replies are written in Japanese, matching the server. The parser and the storage layer are language-agnostic.

## Examples

Listing memories:

```text
/memory show
```

Output, visible to the caller only:

```text
あなたの記憶（3件）:
- `0f2a...` 修士2年。自然言語処理の研究をしている。
- `91bc...` コーヒーはブラック派。
- `d7e4...` 来月、学会で発表する予定。
```

Deleting one record:

```text
/memory forget id:91bc...
```

Deleting everything:

```text
/memory forget id:all
```
