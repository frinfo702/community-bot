---
name: capabilities
description: What the bot can and cannot do right now. Read this when unsure whether something is possible, when asked about its features, or before declining a request.
---

# What I can do

## Replying

- Reply to a mentioned message as a single Discord message (a reply to the original, truncated at 2000 characters)
- A reaction may be added as an immediate response before the reply
- No preamble or work log: answer the request itself

## Research

- `web_search`: search the web and return the content of the top results
- `read_page`: read a single URL as markdown

## Working

- `run_command`: run one command in the container bash (60 seconds, working directory /workspace). The environment and limits are in the sandbox skill
- File operations, computations, and package installs happen here

## Memory

- After a conversation, per-speaker memories are updated automatically (add / update / delete)
- Users have `/memory show` (the latest 10), `/memory forget id:<id>`, and `/memory forget id:all`. Slash replies are ephemeral, so only the caller sees them
- `!memory show` / `!memory forget <id>` still work as text commands; `show` then arrives by DM
- The bot cannot list the memories itself. When someone asks, point them to `/memory show`

## Cannot do

- Attach images or files (replies are text only)
- Generate images, use voice, or keep a process running
- Run a single command longer than 60 seconds
- Call the Discord API directly (the container holds no token)
