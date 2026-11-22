# Mac apps: manual test on a Mac

Bots can use Mail, Messages, Notes, Reminders, Calendar, Contacts and Location on
the person's own Mac through the RoBots desktop app. These run only on macOS, so
CI cannot exercise them. Follow this list on a Mac after building the app.

## Before you start

1. Build and install the desktop app (`pnpm --filter @robots/desktop pack:dir`)
   and open it signed in to a server. A signed build is needed for the macOS
   prompts to name RoBots; an unsigned development build shows Electron's name.
2. In the app's settings, turn on **Let bots use this computer** and click
   **Allow** in the native prompt.
3. Use a bot you own, in your own chat. Mac apps are never offered in routines,
   webhooks, groups, chat apps or other people's chats.
4. Have at least one email in Mail, one chat in Messages, one note, one
   reminder list, one calendar event this week and one contact.

## Each app

For every row: send the prompt, check the approval card, approve it, check the
macOS prompt, then check the answer. Then send a second, similar prompt and
check the "Second time" column.

| App | Test prompt | Approval card | macOS prompt | Second time |
| --- | --- | --- | --- | --- |
| Mail | "Find my latest emails about invoices on my Mac." | "Use Mail on your Mac?" with **Allow in this space** | "RoBots wants access to control Mail" (Automation) | No card |
| Mail draft | "Draft an email to me@example.com saying hi, don't send it." | none if Mail was allowed | none | A compose window stays open in Mail |
| Mail send | "Send me@example.com an email saying test." | "Send this email from Mail on your Mac?" with To, Subject and body, **Allow once** | none | Asks again for every email |
| Messages read | "What were my last Messages chats?" | "Use Messages on your Mac?" | None. Expect a Full Disk Access error the first time: turn on RoBots in System Settings > Privacy & Security > Full Disk Access, quit and reopen RoBots | No card |
| Messages send | "Text +1 555 0100 'on my way'." (use your own number) | "Send this message from Messages on your Mac?" with the number and text | "RoBots wants access to control Messages" | Asks again for every message |
| Notes | "Search my notes for 'trip', then add 'pack charger' to that note." | "Use Notes on your Mac?" | "…control Notes" | No card |
| Reminders | "Add a reminder to buy milk tomorrow at 9am, then show my open reminders." | "Use Reminders on your Mac?" | "…control Reminders" | No card. Then "Mark buy milk done." |
| Calendar read | "What's on my calendar this week?" | "Use Calendar on your Mac?" | "…control Calendar" | No card |
| Calendar create | "Add 'Dentist' tomorrow 3–4pm to my calendar." | "Add “Dentist” to Calendar on your Mac?" with times, **Allow once** | none | Asks again for every event |
| Contacts | "What's Ana's phone number?" | "Use Contacts on your Mac?" | "…control Contacts" | No card |
| Location | "Where am I right now?" | "Share your Mac's location?" | "RoBots would like to use your current location" | Asks again every time |

## Permission states

From the Electron app's web inspector console, on the app's own page:

```js
await window.robotsDesktop.macApps.permissions();
await window.robotsDesktop.macApps.allow("automation-notes");
```

- `permissions()` lists every grant as `granted`, `denied`, `not-determined` or
  `unavailable`. An Automation grant reads `not-determined` until that app has
  been asked once.
- `allow(grant)` shows the macOS prompt when macOS has not asked yet, and
  otherwise opens the right System Settings pane (Automation, Full Disk Access
  or Location Services).
- Turn one Automation switch off in System Settings > Privacy & Security >
  Automation > RoBots, ask the bot to use that app, and check that the bot says
  RoBots is not allowed to control it and how to fix it.
- If a Mac app page shows "Update RoBots on this Mac to allow" instead of an
  Allow button, the installed RoBots desktop app on that Mac is too old for Mac
  app connections. Install the current RoBots desktop app, then check again.

## Offline and settings

1. Quit the desktop app and ask "Search my notes for trip." The bot should say
   the Mac is not connected and to open RoBots on it.
2. In Settings > Approvals > Rules, add a rule that denies `mac_notes_search`
   (or the `mac_notes` connector). The bot should say the rule does not allow it.
3. Add an allow rule for `mac_mail_send`. Sending an email must still show a
   card.
4. Remove the computer from your devices and pair again. Every app asks again.
