import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Env } from "../src/env";
import { handleInteraction } from "../src/interactions";

const URL = "https://example.com/interactions";
const USER_ID = "u1";

let privateKey: CryptoKey;
let publicKeyHex: string;

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  privateKey = pair.privateKey;
  publicKeyHex = await publicKeyOf(pair);
});

/** A fake ConversationDO wide enough for the command store. */
function fakeEnv(publicKey = publicKeyHex) {
  const conversation = {
    memories: vi.fn(async () => [{ id: "m1", content: "ラーメンが好き" }]),
    forgetMemory: vi.fn(async () => "deleted" as const),
    forgetAllMemories: vi.fn(async () => 2),
  };
  const env = {
    DISCORD_PUBLIC_KEY: publicKey,
    CONVERSATION: { idFromName: (name: string) => name, get: () => conversation },
  } as unknown as Env;
  return { env, conversation };
}

/** Sign `<timestamp><body>` the way Discord does. */
async function sign(raw: string): Promise<Headers> {
  const timestamp = "1700000000";
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "Ed25519" },
      privateKey,
      new TextEncoder().encode(timestamp + raw),
    ),
  );
  return new Headers({
    "x-signature-ed25519": toHex(signature),
    "x-signature-timestamp": timestamp,
  });
}

async function signedRequest(body: unknown): Promise<Request> {
  const raw = JSON.stringify(body);
  return new Request(URL, {
    method: "POST",
    headers: await sign(raw),
    body: raw,
  });
}

function command(name: string, options?: unknown[]) {
  return {
    type: 2,
    data: { name, options },
    member: { user: { id: USER_ID } },
  };
}

describe("handleInteraction", () => {
  it("answers the endpoint ping", async () => {
    const { env } = fakeEnv();

    const res = await handleInteraction(await signedRequest({ type: 1 }), env);

    expect(await res.json()).toEqual({ type: 1 });
  });

  it("rejects an unsigned request", async () => {
    const { env, conversation } = fakeEnv();
    const request = new Request(URL, {
      method: "POST",
      body: JSON.stringify({ type: 1 }),
    });

    const res = await handleInteraction(request, env);

    expect(res.status).toBe(401);
    expect(conversation.memories).not.toHaveBeenCalled();
  });

  it("rejects a body that does not match the signature", async () => {
    const { env } = fakeEnv();
    const signedBody = JSON.stringify({ type: 1 });
    const request = new Request(URL, {
      method: "POST",
      headers: await sign(signedBody),
      body: JSON.stringify(command("memory", [{ name: "show" }])),
    });

    const res = await handleInteraction(request, env);

    expect(res.status).toBe(401);
  });

  it("rejects a request signed by another key", async () => {
    const other = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const { env } = fakeEnv(await publicKeyOf(other));

    const res = await handleInteraction(await signedRequest({ type: 1 }), env);

    expect(res.status).toBe(401);
  });

  it("rejects everything when the public key is not configured", async () => {
    const { env, conversation } = fakeEnv("");

    const res = await handleInteraction(
      await signedRequest(command("memory", [{ name: "show" }])),
      env,
    );

    expect(res.status).toBe(401);
    expect(conversation.memories).not.toHaveBeenCalled();
  });

  it("replies ephemerally to /memory show", async () => {
    const { env, conversation } = fakeEnv();

    const res = await handleInteraction(
      await signedRequest(command("memory", [{ name: "show", type: 1 }])),
      env,
    );
    const json = (await res.json()) as {
      type: number;
      data: { content: string; flags: number };
    };

    expect(conversation.memories).toHaveBeenCalledWith(USER_ID, 10, "command");
    expect(json.type).toBe(4);
    expect(json.data.flags).toBe(64);
    expect(json.data.content).toContain("ラーメンが好き");
  });

  it("replies ephemerally to /memory forget with all", async () => {
    const { env, conversation } = fakeEnv();
    const body = command("memory", [
      {
        name: "forget",
        type: 1,
        options: [{ name: "id", type: 3, value: "all" }],
      },
    ]);

    const res = await handleInteraction(await signedRequest(body), env);
    const json = (await res.json()) as { data: { content: string } };

    expect(conversation.forgetAllMemories).toHaveBeenCalledWith(
      USER_ID,
      "command",
    );
    expect(json.data.content).toContain("2件");
  });

  it("keeps an unknown command private too", async () => {
    const { env } = fakeEnv();

    const res = await handleInteraction(
      await signedRequest(command("other")),
      env,
    );
    const json = (await res.json()) as {
      data: { content: string; flags: number };
    };

    expect(json.data.flags).toBe(64);
    expect(json.data.content).toContain("対応していません");
  });
});

async function publicKeyOf(pair: CryptoKeyPair): Promise<string> {
  return toHex(
    new Uint8Array(
      (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer,
    ),
  );
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
