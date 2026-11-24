const PROVIDER_NAMES: Record<string, string> = {
  sendblue: "iMessage",
  slack: "Slack",
  whatsapp: "WhatsApp",
  telegram: "Telegram",
  lark: "Feishu",
  photon: "iMessage (Photon)",
  discord: "Discord",
};

export function messagingProviderName(provider: string): string {
  const telegramBot = /^telegram-(.+)$/.exec(provider)?.[1];
  if (telegramBot) return `Telegram (${telegramBot})`;
  const photonProject = /^photon-(.+)$/.exec(provider)?.[1];
  if (photonProject) return `iMessage (${photonProject})`;
  return PROVIDER_NAMES[provider] ?? provider;
}

export function messagingProviderLabel(provider: string, transport?: string): string {
  if (provider === "sendblue" && ["iMessage", "SMS", "RCS"].includes(transport ?? "")) {
    return transport!;
  }
  return messagingProviderName(provider);
}

export function messagingConnectOptions(
  providers: readonly string[],
  slackInstallAvailable: boolean,
) {
  const available = new Set(providers);
  if (slackInstallAvailable) available.add("slack");
  return [...available].map((provider) => ({
    provider,
    method:
      provider === "slack" && slackInstallAvailable ? ("install" as const) : ("link" as const),
  }));
}
