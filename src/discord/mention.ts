export interface DiscordMessage {
  id: string;
  channel_id: string;
  content: string;
  author: {
    id: string;
    bot?: boolean;
    username?: string;
    global_name?: string | null;
  };
  mentions?: Array<{ id: string }>;
  /** 返信先のメッセージ（Discord の referenced_message）。本文は切り詰められることがある */
  referenced_message?: {
    id: string;
    content: string;
    author?: { id: string; bot?: boolean };
  };
}

export function isBotMentioned(message: DiscordMessage, botId: string): boolean {
  return (message.mentions ?? []).some((mention) => mention.id === botId);
}

export function stripBotMentions(content: string, botId: string): string {
  const pattern = new RegExp(`<@!?${botId}>`, "g");
  return content.replace(pattern, "").replace(/\s+/g, " ").trim();
}
