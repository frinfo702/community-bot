FROM node:24-trixie-slim

# The helper binary must come from the sandbox image tagged with the installed
# @cloudflare/sandbox version (package.json). Update both together.
COPY --from=docker.io/cloudflare/sandbox:1.0.1 /usr/local/bin/sandbox-shim /usr/local/bin/sandbox-shim

RUN mkdir /workspace

# What the bot knows about itself. Kept as files in the sandbox too, so the agent
# can read them from /workspace when it works there.
COPY skills /workspace/.agents/skills
COPY sandbox/AGENTS.md /workspace/AGENTS.md

CMD ["sleep", "infinity"]
