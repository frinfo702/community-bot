/** One file attached to a message. Discord serves it from a signed, short-lived URL. */
export interface DiscordAttachment {
  url: string;
  content_type?: string;
}

export interface DiscordMessage {
  id: string;
  channel_id: string;
  content: string;
  /** Absent in DMs; used to pick where `show` output goes. */
  guild_id?: string;
  attachments?: DiscordAttachment[];
  author: {
    id: string;
    bot?: boolean;
    username?: string;
    global_name?: string | null;
  };
  mentions?: Array<{ id: string }>;
  /** The message this one replies to (Discord's referenced_message). The body can be truncated */
  referenced_message?: {
    id: string;
    content: string;
    author?: { id: string; bot?: boolean };
  };
}

/** The image attachments of a message, in order. Other files (PDF, video, ...) are dropped. */
export function imageUrls(message: DiscordMessage): string[] {
  return (message.attachments ?? [])
    .filter((attachment) => attachment.content_type?.startsWith("image/"))
    .map((attachment) => attachment.url);
}

export function isBotMentioned(message: DiscordMessage, botId: string): boolean {
  return (message.mentions ?? []).some((mention) => mention.id === botId);
}

export function stripBotMentions(content: string, botId: string): string {
  const pattern = new RegExp(`<@!?${botId}>`, "g");
  return content.replace(pattern, "").replace(/\s+/g, " ").trim();
}
