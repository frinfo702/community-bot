import { Files } from "@cloudflare/sandbox";
import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

// Absorb a burst of tasks before the container goes idle and stops.
const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_SECONDS = 20;
const MAX_DOWNLOAD_BYTES = 2_000_000;
const MAX_TEXT_CHARS = 8_000;
const FETCHED_PAGE = "/workspace/fetched-page";

/** Durable Object that owns the sandbox container used for task execution. */
export class SandboxContainer extends DurableObject<Env> {
  private readonly files: Files;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const container = requireContainer(ctx);
    this.files = new Files(container);

    // A restarted Durable Object sets the timeout again.
    if (container.running) {
      void ctx.blockConcurrencyWhile(() =>
        container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS),
      );
    }
  }

  /** Download url with curl inside the container and return the body as text. */
  async fetchText(url: string): Promise<string> {
    const container = requireContainer(this.ctx);
    if (!container.running) {
      container.start({
        image: container.images.sandbox,
        // Fetching the target page is the point of this task.
        enableInternet: true,
      });
      await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
    }

    const process = await container.exec([
      "curl",
      "--silent",
      "--show-error",
      "--location",
      "--max-time",
      `${FETCH_TIMEOUT_SECONDS}`,
      "--max-filesize",
      `${MAX_DOWNLOAD_BYTES}`,
      "--output",
      FETCHED_PAGE,
      url,
    ]);
    const output = await process.output();
    if (output.exitCode !== 0) {
      const stderr = new TextDecoder().decode(output.stderr).slice(0, 200);
      throw new Error(`sandbox curl failed (${output.exitCode}): ${stderr}`);
    }
    const file = await this.files.readFile(FETCHED_PAGE);
    // Keep the prompt small: the summary only needs the beginning of the page.
    return (await file.text()).slice(0, MAX_TEXT_CHARS);
  }
}

function requireContainer(ctx: DurableObjectState): Container {
  const container = ctx.container;
  if (!container) {
    throw new Error("container binding is not configured for SandboxContainer");
  }
  return container;
}
