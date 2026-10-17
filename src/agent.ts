import {
  Think,
  type TurnConfig,
  type TurnContext,
  type TurnResult,
} from "@cloudflare/think";
import type { ContextConfig } from "agents/context";
import { createGateway, tool } from "ai";
import { z } from "zod";
import type { Env } from "./env";
import { jinaRead, jinaSearch } from "./jina";
import { modelIds } from "./models";
import { renderPersona } from "./persona";
import { bundledSkills } from "./skills";

/**
 * Instruction for task turns. The persona block is appended on every turn by
 * beforeTurn(), so it is not repeated here. It is a context block (not
 * getSystemPrompt()) because the skills catalog is one too.
 */
const INSTRUCTION = [
  "You are asked to do multi-step work by Discord server members.",
  "Do the research you need with web_search and read_page, and write only facts you could verify.",
  "Use run_command for file operations and commands (60 seconds per command, working directory /workspace).",
  "Your reply is posted to Discord as one message. Do not write a preamble or a work log; answer the request concisely.",
].join("\n");

/** Agent that handles the task branch of the reply form decision (ISSUE-1876). */
export class TaskAgent extends Think<Env> {
  getModel() {
    // Same model routing as the other paths: Vercel AI Gateway (see models.ts)
    return createGateway({ apiKey: this.env.AI_GATEWAY_API_KEY })(
      modelIds(this.env).chat,
    );
  }

  /** The bundled skills under skills/ so the agent knows what it can do. */
  getSkills() {
    return [bundledSkills];
  }

  /** Always-on instruction, as a context block so it stays with the skills catalog. */
  configureContext(): ContextConfig[] {
    return [{ label: "task", provider: { get: async () => INSTRUCTION } }];
  }

  /**
   * Re-inject the persona (fixed core + the current style layer) at every turn,
   * the same way the text reply path does (ISSUE-1865).
   */
  async beforeTurn(ctx: TurnContext): Promise<TurnConfig> {
    const conversation = this.env.CONVERSATION.get(
      this.env.CONVERSATION.idFromName("log"),
    );
    const style = await conversation.activeStyle();
    return {
      instructions: `${ctx.system}\n\n${renderPersona(style ?? undefined)}`,
    };
  }

  /** Run one command in this agent's own sandbox container (ISSUE-1881). */
  runCommand(command: string) {
    return this.env.SANDBOX.getByName(this.name).runCommand(command);
  }

  /**
   * Run one task turn in wait mode. RPC stubs keep only the last runTurn
   * overload (stream), so the task path calls this method instead.
   */
  handleTask(input: string): Promise<TurnResult> {
    return this.runTurn({ input });
  }

  getTools() {
    return {
      web_search: tool({
        description:
          "Search the web. Returns the top results with their content.",
        inputSchema: z.object({ query: z.string().describe("Search query") }),
        execute: ({ query }) =>
          jinaSearch(query, {
            apiKey: this.env.JINA_API_KEY,
            endpoint: this.env.JINA_SEARCH_URL,
          }),
      }),
      read_page: tool({
        description: "Fetch one web page and return its text as markdown.",
        inputSchema: z.object({
          url: z.string().describe("Absolute http(s) URL"),
        }),
        execute: ({ url }) =>
          jinaRead(url, {
            apiKey: this.env.JINA_API_KEY,
            endpoint: this.env.JINA_READER_URL,
          }),
      }),
      run_command: tool({
        description:
          "Run a shell command in this agent's sandbox (Debian with node/npm; /workspace keeps files while the sandbox runs; 60 seconds per command). Use it for files and computations, not for reading web pages.",
        inputSchema: z.object({
          command: z.string().describe("Command to run with bash -lc"),
        }),
        execute: ({ command }) => this.runCommand(command),
      }),
    };
  }
}
