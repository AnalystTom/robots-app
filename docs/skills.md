# Skills

A skill is written know-how a bot follows for a specific task, such as how you want expenses filed
or how to publish a blog post.

## Use a skill

Bots pick up the right skill on their own when a task matches it. To use one explicitly, type **/**
at the start of a message and choose it.

## Your skills library

Open the account menu (your avatar at the bottom of the sidebar) and choose **Skills**.

- **Your skills** lists skills you or your bots have saved.
- **Plugins** lists skill sets you've added from plugins.
- **Browse** finds ready-made skills. Open one and choose **Add skills**.

Skills you add are available to all your bots. Choose **New skill** to write one yourself: a name,
a short description of when to use it, and the steps.

You can also add skills from a GitHub repository: choose **From GitHub**, paste the repository URL,
then **Preview** and **Add**.

> [!NOTE]
> Skills added from GitHub or a plugin are instructions only. Any scripts they include are not run.

## Safety check

Every skill is checked for risky content when you write or edit it, add it from a plugin, or bring
it in with [Import an agent](./import-an-agent.md), including a RoBots package. A bot saving a skill
is checked the same way.

| Finding                                                            | Risk |
| ------------------------------------------------------------------ | ---- |
| A download piped into a shell, such as `curl … \| sh`              | High |
| Hidden or encoded content that is decoded and run                  | High |
| Credential files (SSH keys, `.env`, keychains) sent somewhere      | High |
| Deleting a whole disk or home folder                               | High |
| Telling the bot to ignore its instructions or keep things from you | High |
| Invisible characters that reorder or hide text                     | High |
| Reading credential files                                           | Low  |
| Instructions in a hidden HTML comment                              | Low  |
| A long encoded blob                                                | Low  |
| Zero-width characters                                              | Low  |

Each finding shows the line it is on. Low-risk findings are listed as a warning and the skill saves
as usual. A high-risk finding stops the skill until you review it and choose **Install anyway**.
A bot cannot install anyway: it is told what was found and asked to leave it to you. The check
reads the `SKILL.md` text only, not files a plugin adds beside it.

## Bots save skills too

After a multi-step task, ask the bot to "save that as a skill". It writes the skill so it, and your
other bots, can repeat the task next time. A skill a bot saves stays in the [space](./spaces.md) it
was made in.

## Teach a task by showing it

Some tasks are easier to show than describe.

1. Open the bot's computer with **Agent computer**.
2. Choose **Teach a task** and describe the result you will demonstrate, such as "Export this week's
   list from the CRM and drop it in the shared folder".
3. Choose **Start recording** and do the task on the bot's screen. The bot watches but does not act.
   Type passwords with **Protected input** so they are not recorded.
4. Choose **Stop teaching**.

The bot posts a **Draft skill** card with the steps it learned, when to use them, what to check, and
when to ask you first. Edit anything that's off, then choose **Save**. **Test** runs it once, and
**Add to routine** puts it on a schedule.

Teach a task is available on the web and desktop apps, not on mobile.
