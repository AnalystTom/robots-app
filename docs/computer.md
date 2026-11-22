# The bot's computer

Every bot has a real computer with a browser, a terminal, files and a desktop, so it can do work
that needs more than a chat.

## Watch it work

Choose **Agent computer** at the top of the chat to open the bot's screen beside the conversation.
Choose **Open in full window** for a larger view. The computer starts when a bot needs it and goes
to sleep when idle; opening it wakes it.

On mobile, open the bot's profile and choose **Open computer**.

## Take control

Choose **Take control** to use the screen yourself, for example to sign in to a site. The header
shows **You have control** until you choose **Release control** (**Release** on mobile).

When the bot hits something only you can do, such as a CAPTCHA or a code texted to your phone, it
asks you to take over. The header shows **Needs you**. Do the step, then choose **I’m done**, or
**Skip** to let the bot carry on without it.

> [!TIP]
> Want the bot to sign in by itself next time? Ask it to save the login. See
> [Reusable credentials](./bot-secrets.md).

## Team or Private

In the bot's settings under **Advanced**, **Computer** is **Team** or **Private**.

- **Team** (the default): bots in the [space](./spaces.md) share one Team Computer, with the same
  files and installed tools. Each bot gets its own screen and browser, and sites you sign in to are
  carried over to the other bots.
- **Private**: the bot gets a computer of its own. Use it when files or sign-ins must not be shared
  with other bots.

## Files

Bots save their work on the computer and send you the results as files in the chat. Every file a bot
has sent is also under **Artifacts** in the account menu.

To have a bot react to files changing, use a [routine](./routines.md) that watches a folder.

## Fix a computer

Open the computer and choose **More computer actions**:

- **Stop computer**: shut it down now. It starts again when needed.
- **Update computer**: save the workspace and install current software.
- **Recover computer**: recreate a computer that is not working.
- **Reset computer**: go back to the last saved workspace. Unsaved work on the computer is lost.

## Use your own computer

In the [desktop app](./desktop-app.md), bots can also run commands and use apps on the computer the
app is installed on. Turn on **Let bots use this computer** in **Settings → General** under
**Computers**. This works with RoBots Cloud, an HTTPS server you connect to, and a
loopback server.
Using apps on screen works on Mac and Windows; on a Mac, allow RoBots under **Accessibility** and
**Screen Recording** in System Settings.

In every [approval mode](./approvals.md), a bot asks before it first uses each app in a space, and
on a connected server before its first command there too, unless a Block rule refuses it. **Allow
in this space** covers the rest of that space, in any chat. Bots use your apps only in chats you
start with your own bots, never from routines or other people's messages.

> [!WARNING]
> A bot with access to your computer can read your files and run programs as you. Only turn it on
> for a computer you would let your bots use unattended.

### A screen on a Linux server

A self-hosted Linux server that lets its admins' bots use the server itself can also give each of
those bots its own screen and browser there. Bots then use the page and screen tools, and admins
can **Take control** from web, desktop and mobile as on any other computer. Everyone else keeps an
isolated computer.

The host computer service needs Xvfb, x11vnc, fluxbox, xdotool, wmctrl, scrot, xterm, xdpyinfo,
websockify and Chromium on its `PATH`, and pass `createHostDesktop` a tools folder whose
`share/novnc` holds noVNC with this repository's `embed.html`, `clipboard-bridge.js` and
`mobile-keyboard.js`, and whose `bin` holds `robots-page-browser`, `page_secrets.py` and
`agent-browser`. Each bot's browser keeps its own profile beside the bots' folders and stores its
sign-ins with the desktop keyring, not the public key the isolated computers use.

**Sign in from this computer**, on that screen, copies the sessions of the sites you pick from a
Chrome or Chromium profile on the server into the bot's browser. Only admins see it, and cookie
values never leave the server.
