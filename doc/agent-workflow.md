---
title: Agent workflow
group: How it works
order: 1
description: The path from a Discord event to a reply, the typed decisions that shape it, and the task agent.
---

# Agent workflow

A turn is a short pipeline with one hard rule: decide first, generate second, remember after. This page follows a message from the gateway to the reply, including the branches that skip generation entirely.

## The turn

1. **Receive.** The Gateway Durable Object posts a Discord event to `/webhook`. The Worker checks `x-discord-gateway-token` before reading the body.
2. **De-duplicate.** `DedupeDO.seen(message.id)` checks a seven-day ledger. A replayed event stops here and returns `duplicate`.
3. **Log.** Every non-bot message is appended to `messages`, whether or not the bot was mentioned. A reply keeps the line it quotes, so a later "this" has a referent. Channel history is the base layer for context.
4. **Handle text commands.** `!memory ...` and `@bot memory ...` are parsed before anything else. Commands work without a mention and return without generating a reply. The `/memory` slash commands are a separate path: Discord POSTs them to `/interactions` and the reply is ephemeral.
5. **Detect corrections.** If the message is a reply to a bot message, Jev is asked whether it corrects the bot. A correction is recorded as a signal even when the bot is not mentioned.
6. **Load context.** The last 20 messages in the channel are read from `ConversationDO`; the active style override is read later, when the reply is generated.
7. **Decide whether to join.** Without a mention, Jev reads `reply-rules.md` and answers whether the bot should reply anyway. A yes continues through the same pipeline as a mention; a no ends the turn after logging.
8. **React immediately.** Jev answers three questions in one parallel batch: is a single emoji enough, does this need multi-step work, and should the answer quote the message it replies to. A message with images skips the first two (see below). The reaction goes first, as the immediate acknowledgment. If the emoji alone is enough, the turn ends here and the quote answer goes unused.
9. **Decide whether this is a task.** When the task answer is yes, the turn runs on the task agent instead of the chat model.
10. **Produce the response.** The task agent may return text; if it fails or returns nothing, the turn falls through to the written reply. The text path loads the speaker's memories, calls the chat model, and runs the reply through the validation gates before posting (see below).
11. **Remember.** After the reply is posted, `extractMemories` runs in the background. Its failure cannot affect the reply.

The webhook itself returns `ok` before steps 3–11 complete. `ctx.waitUntil` keeps the work alive after the response.

## The decision boundary

The split between Jev and the language model is the most important structural choice in the system. Jev answers closed questions; the language model and the task agent produce open text.

| Question | Answer type | Caller decides |
| --- | --- | --- |
| Should the bot reply without a mention? | `noul` | Reply when probability is at least `0.7`; otherwise stop |
| Is a single emoji enough? | `noul` | Reaction only when probability is at least `0.5`; otherwise continue to the written reply |
| Which emoji fits? | `choice` | One of `👍` `😂` `🤔` `👀`; fallback `👍` |
| Is this a complex task? | `noul` | Run the task agent when probability is at least `0.5`; otherwise use the written reply |
| Should the answer quote the message it replies to? | `noul` | Quote when probability is at least `0.5`; otherwise answer plainly |
| Is this a correction? | `noul` | Record when probability is at least `0.5` |
| Does the reply repeat the preceding turn? | `noul` | Cut the repeated sentences, ask the model again, and post the second reply through the same gates |
| Is this exchange worth remembering? | `noul` | Extract when probability is at least `0.5` |
| Keep, update, or delete this memory? | `choice` | Apply only the verdicts Jev returned |
| Should a new memory be added? | `noul` | Add when probability is at least `0.5` |
| Keep or delete a stale memory? | `choice` | Delete only on `delete`; a failed call keeps it |
| Did the reply stay in character? | `choice` | `kept`, `sermon`, or `shift` |

If Jev cannot be reached, the default is always the conservative branch: no reply without a mention, react with `👍`, continue to the written reply, no correction, no memory write, and no cut to a written reply. A missing quote decision keeps the quote, because an ambiguous answer costs the member more than a quoted one. The reaction itself is best-effort; a failed reaction is logged and never blocks the rest of the turn.

## The reply review

The written reply passes one more stage before it is posted: the validation gates in `src/validation.ts`. A gate reads the generated text and the preceding turn and answers pass, or fail with the sentences to cut. The first gate is the repeat check: Jev reads the reply against the preceding turn, and on a hit answers one question per sentence so only the repeated lines are cut. The review runs on the text as a whole, before it is split into messages.

A failed gate sends the cut text back through the same prompt seam, with the withheld draft and the cut lines added to the instructions block, so the retry keeps the day labels, the split rule and the persona. The new reply passes the same gates. One retry is allowed; after that the cut text is posted, and a reply that had nothing left after the cut is not posted at all. Every withheld generation is written to the `reply_rejections` table with the gate, the reason, and the text, so the log shows that a reply was generated and judged inadequate.

The task agent's answer does not pass this stage: its text is posted from the agent DO. Only the chat path is reviewed.

## Response shapes

| Shape | What happens |
| --- | --- |
| Reaction only | The bot adds one emoji to the triggering message and stops. No text is posted. |
| Written reply | The default. Builds the prompt, calls the chat model, and posts a reply, quoted when the quote decision says so. |
| Task | Jev says the request needs multi-step work, so the channel's task agent runs with tools. Its answer is posted as one message, under the same quote rule. |

The reaction is sent before the task decision in every case, so a task that takes twenty seconds still gets an immediate acknowledgment. A failed reaction is only a log line.

A message with images always takes the written reply. The chat call can carry them, while the task prompt is text and a reaction alone would drop them, so the two shortcut decisions are skipped for it.

## Prompt assembly

The text prompt is assembled in `src/prompt.ts` and has a fixed order:

1. An optional channel summary, when one exists.
2. An optional system message with up to ten memories about the current speaker.
3. The recent conversation, oldest to newest. Human messages are prefixed with their display name; bot messages become `assistant` turns. Images attached to the request message are sent as `image_url` content parts on the same turn, so the model can look at them. Older messages stay text-only, which keeps an expired Discord URL from failing the call.
4. The botch-doc block (`skills/botch-doc/SKILL.md`, frontmatter stripped): what the bot can do, the memory commands, and the docs link. The same file is the task agent's `botch-doc` skill, so both paths answer questions about the bot the same way.
5. The instructions block, just before the persona: the split rule, plus the retry instruction when the reply review asked for the reply again.
6. The persona block, as the final system message.

The persona goes last on every turn. It is rebuilt each time from `persona.md`, with the active style override if the nightly revision has applied one. The core section is never replaced. The retry of the reply review adds its instruction to the same block, so the instruction and the persona keep their order.

The task path builds a different, single user message: the last ten lines of the channel and a sentence naming the request and the member who asked. The agent adds the persona itself on every turn through its `beforeTurn` hook.

## The task path

The task agent is the one place in the system with a tool loop. It is bounded on purpose.

- **Session.** `TaskAgent` is one Cloudflare Agents SDK session per channel. It keeps its own turn history, so a follow-up task in the same channel continues the previous work.
- **Tools.** `web_search` and `read_page` go through Jina (30-second timeout, 8,000 characters per result; `read_page` accepts HTTP(S) only). `run_command` runs `bash -lc` in the channel's sandbox container with a 60-second timeout, keeping the last 4,000 characters of output.
- **Workspace.** `/workspace` keeps files for as long as the container runs, and each channel has its own agent and container. The container starts on demand with internet access and stops after five minutes of inactivity.
- **Output.** One completed turn becomes one Discord message. The agent is told not to include preamble or a work log. The turn runs in the channel's agent DO, which posts the answer itself, because a task turn often takes longer than the webhook's 30-second `waitUntil()` window.
- **Fallback.** If the turn fails or produces no text, the agent posts the normal written reply instead.

The web tools are called with the bot's Jina key from the Worker; the container holds no credentials, and the model chooses the commands.

## Signals after the reply

Two kinds of feedback are recorded for the nightly style revision:

- **Reactions** on bot messages. Only reactions added by someone other than the bot are stored, and only when the target message was authored by the bot.
- **Corrections**. A reply to a bot message is classified by Jev; a positive result stores the user's text as a correction signal.

Both land in the `signals` table with a unique constraint on `(message_id, user_id, kind, value)`, so a replayed gateway event does not count twice.

## What is not here

Slash commands do not use this path at all: Discord POSTs them to `/interactions` (signature-checked, ephemeral reply), and the Gateway never sees `INTERACTION_CREATE`. The task agent is the only path with a tool loop; the conversational path is one decision, one generation, and at most one response per message.
