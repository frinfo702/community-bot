export interface DiscordMessage {
  id: string;
  channel_id: string;
  content: string;
  author: { id: string; bot?: boolean; username?: string };
  mentions?: Array<{ id: string }>;
}

export function isBotMentioned(message: DiscordMessage, botId: string): boolean {
  return (message.mentions ?? []).some((mention) => mention.id === botId);
}

export function stripBotMentions(content: string, botId: string): string {
  const pattern = new RegExp(`<@!?${botId}>`, "g");
  return content.replace(pattern, "").replace(/\s+/g, " ").trim();
}
