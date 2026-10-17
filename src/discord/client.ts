const API_BASE = "https://discord.com/api/v10";
const MAX_429_RETRIES = 3;

export type SleepFn = (ms: number) => Promise<void>;

export interface DiscordClientOptions {
  token: string;
  fetchFn?: typeof fetch;
  sleep?: SleepFn;
}

export class DiscordClient {
  private readonly token: string;
  private readonly fetchFn: typeof fetch;
  private readonly sleep: SleepFn;

  constructor(options: DiscordClientOptions) {
    this.token = options.token;
    // Without bind, workerd throws Illegal invocation (calling global fetch as a method changes this)
    this.fetchFn = options.fetchFn ?? fetch.bind(globalThis);
    this.sleep =
      options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async triggerTyping(channelId: string): Promise<void> {
    await this.request(`/channels/${channelId}/typing`, { method: "POST" });
  }

  async postMessage(
    channelId: string,
    content: string,
    options: { replyTo?: string } = {},
  ): Promise<void> {
    const body: {
      content: string;
      message_reference?: { message_id: string; fail_if_not_exists: boolean };
    } = { content: content.slice(0, 2000) };
    if (options.replyTo) {
      body.message_reference = {
        message_id: options.replyTo,
        fail_if_not_exists: false,
      };
    }

    const res = await this.request(`/channels/${channelId}/messages`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      throw new Error(`discord post failed (${res.status}): ${detail}`);
    }
  }

  /** Add an emoji reaction to a message (Discord returns 204 on success). */
  async addReaction(
    channelId: string,
    messageId: string,
    emoji: string,
  ): Promise<void> {
    const res = await this.request(
      `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`,
      { method: "PUT" },
    );
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      throw new Error(`discord reaction failed (${res.status}): ${detail}`);
    }
  }

  /** Post an image attachment (multipart). content is optional body text. */
  async postImage(
    channelId: string,
    image: { data: Uint8Array; contentType: string; filename?: string },
    options: { content?: string; replyTo?: string } = {},
  ): Promise<void> {
    const form = new FormData();
    form.append(
      "files[0]",
      new Blob([image.data], { type: image.contentType }),
      image.filename ?? `image.${extensionFor(image.contentType)}`,
    );
    const payload: {
      content?: string;
      message_reference?: { message_id: string; fail_if_not_exists: boolean };
    } = {};
    if (options.content) payload.content = options.content;
    if (options.replyTo) {
      payload.message_reference = {
        message_id: options.replyTo,
        fail_if_not_exists: false,
      };
    }
    form.append("payload_json", JSON.stringify(payload));

    const res = await this.request(`/channels/${channelId}/messages`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      throw new Error(`discord image post failed (${res.status}): ${detail}`);
    }
  }

  /** Opens (or reuses) a DM channel with the user and returns its channel id. */
  async openDM(userId: string): Promise<string> {
    const res = await this.request("/users/@me/channels", {
      method: "POST",
      body: JSON.stringify({ recipient_id: userId }),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      throw new Error(`discord dm open failed (${res.status}): ${detail}`);
    }
    return ((await res.json()) as { id: string }).id;
  }

  /** The guild's custom emojis a reaction can use. Unavailable ones are dropped. */
  async listGuildEmojis(
    guildId: string,
  ): Promise<Array<{ id: string; name: string }>> {
    const res = await this.request(`/guilds/${guildId}/emojis`, { method: "GET" });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      throw new Error(`discord emoji list failed (${res.status}): ${detail}`);
    }
    const list = (await res.json()) as Array<{
      id: string;
      name: string;
      available?: boolean;
    }>;
    return list
      .filter((emoji) => emoji.available !== false)
      .map(({ id, name }) => ({ id, name }));
  }

  /** Open the global slash commands. PUT replaces the whole list, so it is idempotent. */
  async putGlobalCommands(
    applicationId: string,
    commands: unknown[],
  ): Promise<void> {
    const res = await this.request(`/applications/${applicationId}/commands`, {
      method: "PUT",
      body: JSON.stringify(commands),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      throw new Error(`discord command register failed (${res.status}): ${detail}`);
    }
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchFn(`${API_BASE}${path}`, {
        ...init,
        headers: {
          Authorization: `Bot ${this.token}`,
          // Do not set Content-Type for multipart so fetch adds the boundary itself
          ...(init.body instanceof FormData
            ? {}
            : { "Content-Type": "application/json" }),
        },
      });

      if (res.status !== 429 || attempt >= MAX_429_RETRIES) {
        return res;
      }

      let waitMs = 1000;
      const body = (await res.json().catch(() => null)) as {
        retry_after?: number;
      } | null;
      if (body && typeof body.retry_after === "number") {
        waitMs = Math.ceil(body.retry_after * 1000);
      }
      await this.sleep(waitMs + 50);
    }
  }
}

/** Pick an extension Discord treats as an image. */
function extensionFor(contentType: string): string {
  if (contentType.includes("jpeg")) return "jpg";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";
  return "png";
}
