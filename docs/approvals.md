# Approvals

Decide how much a bot can do without asking you first.

## Choose a mode

Open **Settings → Approvals** and pick a **Mode**:

- **Ask**: the bot asks before any action that changes something, such as sending an email or
  editing a document. Reading usually doesn't ask. Saving to memory asks first once the run's
  permissions are reduced: after it reads outside content (including what `recall_memory` or
  `reflect_memory` returns), when it resumes after a pause, and in runs that didn't start from your
  message in RoBots, such as routines, webhooks, bot messages and chat-app messages. Memory the bot
  recalls automatically, its notes and chat history don't make it ask.
- **Auto**: an approval model checks each action against what you asked for. Actions that fit go
  ahead; the bot asks when one is off-task, or can't be undone and you didn't ask for it.
- **Never ask**: every action runs without waiting.

**Auto** needs an **Approval model**, set in **Settings → Models**. See [Models](./models.md).

> [!TIP]
> Start with **Ask** or **Auto**. As you approve the same action again and again, choose
> **Always allow** on the card and the bot stops asking for that one.

## Rules

**Settings → Approvals → Rules** is an ordered list that decides an action before the mode does.
Each rule names:

- **What it matches**: an **Action** by name, where `*` matches anything (`send_email`, `gmail_*`,
  `user_computer_*`), every action of an **App** (`gmail`), or a **Kind** of action (Email,
  Purchases).
- **Who started the run**, optionally: you in the app, a routine, a webhook, a chat app, or another
  bot. **Anyone** matches every run.
- **Allow**, **Ask** or **Deny**.

How rules decide:

- **Deny beats everything.** If any matching rule denies, the action is refused, wherever the rule
  sits in the list and in every mode. The bot is told it isn't allowed and says so in the chat.
- Otherwise the **first** matching rule decides between **Allow** and **Ask**. **Ask** shows a card
  even in **Never ask**; **Allow** skips the card and the approval model.
- If no rule matches, the **Mode** decides as before.
- A rule that can't be read never allows: the action asks instead.
- **Allow** never skips what always asks (see below), a purchase, a **Block** or **Always ask** entry
  in your lists, or the first fetch from a new site.
- A routine's change trigger is checked against rules for **A routine**; one that would ask or
  deny can't run.

Use the up and down arrows to reorder rules. **Test a rule** shows which rule would match an action
name and who started the run, without saving anything.

## Audit log

Every decision about a bot's action is written to your organization's audit log as `tool.decision`
**before** the action runs: allowed, asked, approved by you, or denied. Each entry names the bot, the
action, who started the run, the mode, and the rule or list that decided it. It never includes the
action's arguments. If the entry can't be written, the action doesn't run and the bot tells you.
See [Audit log](./self-host-audit-log.md).

## Approval cards

When a bot needs a yes, it posts a card in the chat showing exactly what it wants to do:

- **Allow once**: just this time.
- **Always allow this tool**, or **Always allow** a site: stop asking for it.
- **Deny**: the bot doesn't do it and carries on.

Cards never block the chat. Keep talking to the bot, and answer the card whenever you're ready. You
get a notification when a bot is waiting on you, if notifications are on in the bot's settings.

## Allow and Block lists

Every **Always allow** choice is saved in **Settings → Approvals**. Switch any entry between
**Allow** and **Block**, or **Remove** it. A blocked action is refused without a card, in every
mode. **Preview** shows what would happen for a given tool before you change anything.

To stop one bot from ever using a tool, open the bot's settings, expand **Advanced**, and use
**Disable a tool** under **Tools**.

## What always asks

In **Auto** and **Ask**, these always show a card, and **Always allow** doesn't skip it:

- Changing a bot's instructions or model, and creating a space.
- A routine that watches a command, or that names a site the run found in outside content.

**Never ask** runs all of them. The one exception is accepting another owner's bot connection, which
it refuses when someone else started the run or outside content entered it.

## Spending limit

Once a bot can pay, with a card in the Vault or a connected wallet, **Settings → Approvals** also
shows a **Spending limit**: an amount, in US dollars, euros, pounds or shekels, that resets every
day, week or month, or never. Days and months follow your timezone; weeks start on Monday. It
covers every bot and space on your account, and only you can change it.

Every payment you approve counts against it: a checkout's pay button at the total the page shows,
or the amount the button names if that is more, and a wallet purchase at its exact amount. A pay button counts when the bot's page browser recognizes
it as paying, the same presses that always ask; on a computer without the page browser, nothing is
recognized, so only wallet purchases count. A payment that would go over the limit is refused before
you are asked, and the bot tells you. While a limit is set, a checkout whose total can't be read, or
is in another currency, is refused too. A wallet purchase that is denied, expires or fails stops
counting, and so does a press the page refused because it changed. A press that went through still
counts if the shop later declines it.

Choosing a payment method on a tab or radio option does not ask. A button that submits a form or
says **Place order** still asks, even when it is marked as a tab or radio option.

Below the limit, **Recent payments** lists the latest payments that count, with the site, the bot,
when and how much, whether or not a limit is set.

A page in another dollar or pound currency is counted as if it were in US dollars or pounds. That
is more than it costs for nearly all of them; a Cayman Islands dollar is worth a little more than a US
dollar, so a price in it counts a little less. A saved card pays whatever the shop charges, so the limit relies on
the total the page shows; only a wallet's single-use card holds the shop to the approved amount.

## Per space

Approval settings are account defaults that every [space](./spaces.md) follows. To give one space
different rules, open its settings and choose **Customize** next to **Approvals**.
