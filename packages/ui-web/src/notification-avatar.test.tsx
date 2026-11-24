import { notificationAvatarSource, robotPresetValue } from "@robots/core";
import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";
import { BotAvatar } from "./bot-avatar.js";

it.each<[string, { color: string; avatarSet?: "robots" }]>([
  ["organic", { color: "#14b8a6" }],
  ["shipped shape", { color: "#8B5CF6::shape_3" }],
  ["robots", { color: "#14b8a6", avatarSet: "robots" }],
  ["robot", { color: robotPresetValue("hero") }],
])("draws the %s notification portrait as the same robot the chat avatar shows", (_, avatar) => {
  const bot = { id: "agent-1", ...avatar };
  const source = notificationAvatarSource(bot);
  const chat = renderToString(
    <BotAvatar color={bot.color} identity={bot.id} avatarSet={bot.avatarSet} activity="idle" />,
  );
  expect(source).toMatch(/^data:image\/svg\+xml,/);
  expect(chat).toContain(`src="${source}"`);
});
