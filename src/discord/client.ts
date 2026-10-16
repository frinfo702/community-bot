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
    // bind しないと workerd で Illegal invocation になる（global fetch を method 呼び出しすると this が変わるため）
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

  /** メッセージに絵文字リアクションを付ける（Discord は成功時 204）。 */
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

  private async request(path: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchFn(`${API_BASE}${path}`, {
        ...init,
        headers: {
          Authorization: `Bot ${this.token}`,
          "Content-Type": "application/json",
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
