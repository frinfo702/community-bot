---
title: Commands
group: Reference
order: 1
description: The text commands available in Discord, what they return, and where the output goes.
---

# Commands

The bot accepts a small set of text commands. They are handled before the reply pipeline, work without a mention, and never call the language model.

## Command reference

| Command | What it does |
| --- | --- |
| `!memory show` | Sends the caller's memories by DM. Shows at most ten, newest first. |
| `!memory forget <id>` | Deletes one memory owned by the caller. |
| `!memory forget all` | Deletes every memory owned by the caller. |
| `!memory` | Prints the command help. |

The mention form works too:

```text
@community-bot memory show
@community-bot memory forget 3f1c...
```

The leading `!` is not required when the bot is mentioned. A bare `memory show` without a mention is treated as normal conversation.

## How `show` is delivered

Memories are private, so `show` goes to a DM rather than the channel.

1. The bot opens or reuses a DM channel with the author.
2. It posts the formatted list there.
3. In a server channel, it replies to the original message with a short confirmation.

If the DM cannot be opened, the bot says so in the channel without repeating the memories. The list format is one line per memory: the id in backticks, then the first 80 characters of the content. When the limit is reached, the message notes that only the newest ten are shown.

In a direct message, there is no channel confirmation; the list is the only response.

## Ownership

`forget` is scoped to the caller. The lookup returns one of three outcomes:

- `deleted`: the record existed and belonged to the caller.
- `not_found`: no record with that id.
- `not_owner`: the record exists but belongs to someone else.

Only the first outcome removes a row. `forget all` deletes the caller's records one by one so every delete gets its own `memory_log` entry with actor `command`.

## What commands do not do

- They do not mention the model, Jev, or the sandbox.
- They do not appear as slash commands. The Gateway does not forward `INTERACTION_CREATE`, so this is intentionally a text-only interface.
- They do not bypass the log. A `show` records a read event; a `forget` records a delete with the actor and reason.

The command replies are written in Japanese, matching the server. The parser and the storage layer are language-agnostic.

## Examples

Listing memories:

```text
!memory show
```

Output, delivered by DM:

```text
あなたの記憶（3件）:
- `0f2a...` 修士2年。自然言語処理の研究をしている。
- `91bc...` コーヒーはブラック派。
- `d7e4...` 来月、学会で発表する予定。
```

Deleting one record:

```text
!memory forget 91bc...
```

Deleting everything:

```text
!memory forget all
```
