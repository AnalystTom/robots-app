# Import an OpenClaw, Hermes, Grok Bot or ChatGPT agent

Moving from OpenClaw, Hermes Agent, Grok Bot or another assistant such as ChatGPT or Claude? RoBots
can turn it into a new bot, with its instructions, memory and skills, next to the bots you already
have. A bot exported from another RoBots install, such as your laptop, imports the same way.

Open **Settings → General** and choose **Import an agent**. Import is available in the web app
and the desktop app.

## From another RoBots install

1. On the install that has the bot, open the bot's settings, choose **Advanced**, then
   **Export bot**. Tick **Include memory notes** if the bot's memory should come along, then
   choose **Export**. You get one `.robot.json` file.
2. On the other install, open **Import an agent**, choose **Choose file** under
   **RoBots package**, and pick that file.

A package holds the bot's name, description, look and instructions, its model as a hint, the
skills in your library, its scheduled routines and, when you ticked it, its memory notes. It never
holds keys, passwords, sign-ins, connections, chats, or account and space ids, and text shaped like
a key is replaced with `[removed]`. Routines that start on a webhook, GitHub, email, a chat app or a
watched page are left out because they belong to the old install. The model is used only when you
have that provider connected on the new install.

A package made by a newer version of RoBots is refused with a message asking you to update.

## From OpenClaw or Hermes

Choose either:

- **Choose folder**: the agent's home folder, such as `~/.openclaw` or `~/.hermes`.
- **Choose backup**: a `.zip` or `.tar.gz` backup of that folder.

The folder or backup is read on your device. Only the files the import uses are sent, and
`.env` and `auth.json` are read only if you tick **Include API keys**.

## From Grok Bot

Grok Bot has no export button, so each Bot writes down its own setup:

1. Under **Grok Bot**, choose **Copy prompt** and send it to the Bot in Grok Bot. It asks the Bot to
   write its instructions, memory, skills, routines and connected apps as a `grok-bot-export` JSON
   file, without changing anything or including passwords or keys.
2. Paste the Bot's whole reply and choose **Continue**, or choose **Choose file** for the file it
   made. A Bot that split its export into several parts: paste or choose all of them together.
   When one reply holds several Bots, pick the one to import; import each Bot separately.

Exports written for Hermes Agent's or OpenMausBot's Grok Bot importers use the same format and
import here too.

Routines on a schedule come over paused. Turn each one off in Grok Bot before you turn it on here,
so it doesn't run twice. Routines that start on an event (Slack, GitHub, email, a webhook), or
whose schedule could not be read, are saved in the bot's memory as `grok-bot-routines.md`, with
their trigger and full instruction, so you can set them up again. Connected apps with a remote
MCP address become MCP servers you sign in to again; **Not imported** lists the other apps to
connect again. Chats, files on the Bot's computer and sign-ins stay in Grok Bot.

## From another assistant

For ChatGPT, Claude, Gemini or any other assistant:

1. Choose **Copy prompt** and send the prompt to your old assistant. It asks it to write down its
   name, instructions, what it remembers about you, and the procedures it follows.
2. Paste its reply and choose **Continue**, or choose **Choose file** if it gave you a `.md` file.

## Choose what comes along

Before anything is created, you see every item the import found and tick what to keep:

| Item                                         | Becomes                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| Instructions (`SOUL.md`, `AGENTS.md`, …)     | The new bot's instructions                                               |
| Memory (`MEMORY.md`, `USER.md`, daily notes) | The bot's memory, or memory shared by all your bots                      |
| Skills                                       | Skills in the library all your bots share                                |
| Model                                        | The bot's model, when you have that provider connected or import its key |
| MCP servers                                  | MCP servers the bot asks before using                                    |
| Scheduled jobs                               | Routines, paused until you turn them on                                  |
| API keys                                     | Model connections, only when you tick **Include API keys**               |

Anything that runs code or acts on its own (skills, MCP servers, routines) starts unticked, as do
untouched defaults the old agent wrote and text that looks like it contains a key. **Not
imported** lists what was left out and why, such as files only the old runtime uses.

Every skill is checked for risky content before it is imported, as described in
[Skills](./skills.md#safety-check). Each finding is listed under the skill with its line. Ticking a
skill with a high-risk finding asks you to confirm with **Install anyway**.

## After the import

The new bot opens with a checklist of anything that still needs you, such as a credential an MCP
server needs or a paused routine. Each item links to where you finish it. Your other bots,
including Chief, are not changed.

## Package format

A RoBots package is one UTF-8 JSON file, named `<bot-name>.robot.json`. Version 1 looks like this:

```json
{
  "format": "robots.bot-package",
  "version": 1,
  "exportedAt": "2026-11-19T10:00:00.000Z",
  "bot": {
    "name": "Pebble",
    "description": "Keeps my week in order.",
    "instructions": "You are Pebble. Be brief.",
    "color": "robot:teal.antenna.happy.hoodie.none",
    "avatarSet": "robots",
    "model": { "provider": "openrouter", "modelId": "anthropic/claude-sonnet-4.6" }
  },
  "skills": [{ "content": "---\nname: digest\ndescription: Summarise the inbox.\n---\n\nSteps.\n" }],
  "routines": [
    {
      "name": "Morning digest",
      "prompt": "Summarise my inbox with @digest.",
      "crons": ["0 8 * * 1-5"],
      "timezone": "Europe/Berlin"
    }
  ],
  "memory": [{ "path": "MEMORY.md", "content": "Prefers short replies." }]
}
```

| Field       | Meaning                                                                  |
| ----------- | ------------------------------------------------------------------------ |
| `format`    | Always `robots.bot-package`.                                             |
| `version`   | The format version. This version of RoBots reads version 1.              |
| `bot.model` | A hint, or `null`. It is used only when that provider is connected.      |
| `skills`    | Each skill's full `SKILL.md`, at most 100,000 characters.                |
| `routines`  | Scheduled routines only: 1 to 5 cron schedules and an IANA time zone.    |
| `memory`    | Relative Markdown paths in the bot's memory. Empty unless you ticked it. |

Every object is strict: a field the version does not define makes the package invalid, so ids,
secrets or chat history cannot travel in it. A file whose `version` is not a whole number of at
least 1 is refused as an unknown version; a larger version than this RoBots reads is refused with a
request to update. The schema is `BotPackageSchema` in `packages/contracts/src/bot-package.ts`, and
`exportBotPackage` and `importBotPackage` in `packages/core/src/bot-package.ts` are the only code
that writes and reads it.
