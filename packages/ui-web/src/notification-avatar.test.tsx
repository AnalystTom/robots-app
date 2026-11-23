import { notificationAvatarSource } from "@robots/core";
import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";
import { BotAvatar } from "./bot-avatar.js";

it.each<[string, { color: string; avatarSet?: "robots" }]>([
  ["organic", { color: "#14b8a6" }],
  ["shipped shape", { color: "#8B5CF6::shape_3" }],
  ["robots", { color: "#14b8a6", avatarSet: "robots" }],
])("sends the push icon of a %s bot as the RoBots character its chat avatar shows", (_, avatar) => {
  const bot = { id: "agent-1", ...avatar };
  const chat = renderToString(
    <BotAvatar color={bot.color} identity={bot.id} avatarSet={bot.avatarSet} />,
  );
  const [, shown] = /<img src="([^"]*)"/.exec(chat) ?? [];
  expect(shown).toMatch(/^data:image\/svg\+xml,%3Csvg/);
  expect(notificationAvatarSource(bot)).toBe(shown);
});
