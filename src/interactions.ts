import {
  memoryStore,
  parseMemoryInteraction,
  runMemoryCommand,
  type InteractionOption,
} from "./commands";
import type { Env } from "./env";

/** Interaction and callback types from the Discord interactions spec. */
const PING = 1;
const APPLICATION_COMMAND = 2;
const MESSAGE_WITH_SOURCE = 4;
/** Ephemeral: only the member who ran the command sees the reply. */
const EPHEMERAL = 64;
/** Launch the app's Activity. Discord joins the caller to it. */
const LAUNCH_ACTIVITY = 12;
const ED25519 = { name: "Ed25519" };

interface Interaction {
  type: number;
  data?: { name?: string; options?: InteractionOption[] };
  member?: { user?: { id: string } };
  user?: { id: string };
}

/**
 * Discord POSTs slash commands to the app's Interactions Endpoint URL. The
 * gateway library does not forward INTERACTION_CREATE, so this is the only path
 * interactions arrive on and the Ed25519 signature is the only authenticator.
 */
export async function handleInteraction(
  request: Request,
  env: Env,
): Promise<Response> {
  const interaction = await verifiedInteraction(
    request,
    env.DISCORD_PUBLIC_KEY,
  );
  if (!interaction) {
    return new Response("invalid request signature", { status: 401 });
  }

  if (interaction.type === PING) return Response.json({ type: PING });

  const name = interaction.data?.name;
  if (
    interaction.type !== APPLICATION_COMMAND ||
    (name !== "memory" && name !== "cafe")
  ) {
    return Response.json(ephemeral("このコマンドには対応していません。"));
  }

  // /cafe launches the Activity; Discord handles the rest from this callback.
  if (name === "cafe") {
    return Response.json({ type: LAUNCH_ACTIVITY });
  }

  // In a server the user sits under member; in a DM the interaction has user
  const userId = interaction.member?.user?.id ?? interaction.user?.id;
  if (!userId) return Response.json(ephemeral("実行者が分かりませんでした。"));

  try {
    const reply = await runMemoryCommand(
      parseMemoryInteraction(interaction.data?.options),
      userId,
      memoryStore(env),
    );
    return Response.json(ephemeral(reply));
  } catch (err) {
    console.error("interaction failed", err);
    return Response.json(ephemeral("処理に失敗しました。"));
  }
}

/**
 * Read the raw body and verify the Ed25519 signature Discord puts on
 * `<timestamp><body>`. Null means the request did not come from Discord: the
 * endpoint is public, so an unverified body is never parsed.
 * https://discord.com/developers/docs/interactions/overview#setting-up-an-endpoint
 */
async function verifiedInteraction(
  request: Request,
  publicKey: string,
): Promise<Interaction | null> {
  const body = await request.text();
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  if (!publicKey) {
    console.error("DISCORD_PUBLIC_KEY is not set");
    return null;
  }
  if (!signature || !timestamp) return null;

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      hexToBytes(publicKey),
      ED25519,
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      ED25519,
      key,
      hexToBytes(signature),
      new TextEncoder().encode(timestamp + body),
    );
    if (!valid) return null;
  } catch (err) {
    // A malformed key or signature is a failed verification, not a server error
    console.error("signature check failed", err);
    return null;
  }

  return JSON.parse(body) as Interaction;
}

/** An ephemeral callback: the content never reaches the channel. */
function ephemeral(content: string) {
  return {
    type: MESSAGE_WITH_SOURCE,
    data: { content: content.slice(0, 2000), flags: EPHEMERAL },
  };
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
