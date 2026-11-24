import { notificationAvatarSource } from "@robots/core";
import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";
import { BotAvatar } from "./bot-avatar.js";

it.each(["#14b8a6", "#8B5CF6::shape_3"])(
  "sends the push icon of a %s bot as the RoBots character its chat avatar shows",
  (color) => {
    const bot = { id: "agent-1", color };
    const chat = renderToString(<BotAvatar color={bot.color} identity={bot.id} />);
    const [, shown] = /<img src="([^"]*)"/.exec(chat) ?? [];
    expect(shown).toMatch(/^data:image\/svg\+xml,%3Csvg/);
    expect(notificationAvatarSource(bot)).toBe(shown);
  },
);
