import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

// Absorb a burst of commands before the container goes idle and stops.
const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;
// `timeout` stops the command and every process it started.
const COMMAND_TIMEOUT_S = 60;
const MAX_OUTPUT_CHARS = 4_000;

export interface CommandOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Durable Object that owns the sandbox container used for task execution. */
export class SandboxContainer extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const container = requireContainer(ctx);

    // A restarted Durable Object sets the timeout again.
    if (container.running) {
      void ctx.blockConcurrencyWhile(() =>
        container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS),
      );
    }
  }

  /** Run one shell command in the container and return its output. */
  async runCommand(command: string): Promise<CommandOutput> {
    const container = requireContainer(this.ctx);
    if (!container.running) {
      container.start({
        image: container.images.sandbox,
        // The model decides what runs here; the container holds no credentials.
        enableInternet: true,
      });
      await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
    }

    const process = await container.exec([
      "timeout",
      "--kill-after=5",
      `${COMMAND_TIMEOUT_S}`,
      "bash",
      "-lc",
      command,
    ]);
    const output = await process.output();
    const decoder = new TextDecoder();
    // Keep the tail: what a failing command says matters at the end.
    return {
      exitCode: output.exitCode,
      stdout: decoder.decode(output.stdout).slice(-MAX_OUTPUT_CHARS),
      stderr: decoder.decode(output.stderr).slice(-MAX_OUTPUT_CHARS),
    };
  }
}

function requireContainer(ctx: DurableObjectState): Container {
  const container = ctx.container;
  if (!container) {
    throw new Error("container binding is not configured for SandboxContainer");
  }
  return container;
}
