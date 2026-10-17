---
name: sandbox
description: The environment and limits of the sandbox that run_command uses (Debian, /workspace). Read before doing work with commands, or when a task takes long or needs files kept around.
---

# Sandbox

- Debian slim + Node.js 24 + npm. Commands run one at a time through `bash -lc`. Only the container filesystem is here (the virtual files behind Think's read / write tools are separate and not shared)
- Every command is cut off at 60 seconds. Split longer work, or rewrite it to finish in one run
- The working directory is /workspace. Put created files there
- The network is available (npm install, curl). There are no credentials, so anything that needs a login or an API key fails
- stdout and stderr are kept to the last 4000 characters each. Keep noisy commands small with `| tail`
- The disk is temporary. After 5 minutes without activity the container stops, and the next start resets /workspace to the image state: AGENTS.md and .agents/skills only. Put results worth keeping in the reply
- git / python3 / curl and friends may be missing. Check with `command -v <name>` and try `apt-get update && apt-get install -y --no-install-recommends <name>`
- Only the command output comes back. A file that was created says nothing to the requester
