# DESIGN.md — RoBots app (web, Electron desktop, Expo mobile)

"Paper & Ink". Token names come from the shared `packages/ui-tokens/src/tokens.css`.

## Brand intent
RoBots is a place you run a small crew of AI bots and stay in charge. The app should feel like a calm, well-lit desk: warm paper, ink-black text, one teal accent, and the bots as the only colour. Never loud, never "AI sparkle". Control (allow, ask, deny, receipts) is the product, so rules and approvals are drawn plainly and early.

## Colour tokens
Names are the existing `@robots/ui-tokens` names, plus NEW names. The NEW slots (`brand*`, `*-soft`, `shadow-*`, `radius-*`) are in the code today; the values in the table for existing names are the target and have not moved yet.

| Token | Light | Dark | Use |
|---|---|---|---|
| background | #F7F3EA | #0D1416 | page |
| card | #FFFDF8 | #152024 | cards, bubbles, inputs |
| dialog / popover | #FFFDF8 | #111B1E / #152024 | raised surfaces |
| foreground | #14181B | #F2EEE6 | text |
| muted-foreground | #59616A | #A3ADB2 | secondary text (5.7:1 / 8.1:1 on page) |
| border | #E3DBCA | #22323A | hairlines |
| input | #D6CCB7 | #2D404A | input outline |
| primary / primary-foreground | #14181B / #F7F3EA | #F2EEE6 / #0D1416 | filled button, user bubble |
| brand (NEW) | #15788A | #3AA6B7 | the one accent: focus ring, selected row dot, links on marketing |
| brand-soft (NEW) | #D6ECEE | #12343B | selected row fill, info chip |
| brand-ink (NEW) | #0F6575 | #6DCAD7 | link text on paper, the only brand-coloured body text |
| accent | ink at 6% | ink at 10% | hover fill (unchanged meaning; do not use for brand) |
| sidebar | #EFE8D9 | #111B1E | sidebar |
| success / warning / destructive | #1F7A4C / #9A5A00 / #B4362B | #7AD9A1 / #F2C068 / #FF9A8F | Allow / Ask / Deny, status |
| *-soft (NEW) | #DFF1E6 / #FDEFD5 / #FBE2DF | #173A2A / #3B2C12 / #43201D | chip backgrounds |

Rules: surfaces are opaque; text and hover are ink at an opacity. Bot colours come from the bot, never from tokens. Brand teal on page is 4.6:1, so use it for icons, rings and large text; link text uses `brand-ink`. The existing `link` token switches to `brand-ink` in the grey-to-paper follow-up PR; this PR changes no existing values.

## Typography
- Sans: Geist is the target, with a system fallback (mobile native screens keep the system font; see Where tokens live). The font swap lands in the grey-to-paper follow-up PR. Mono: Geist Mono for receipts, ids, code, kbd.
- Display serif: Instrument Serif italic, for marketing headlines only. Never in the app.
- Weights 400 / 500 / 600 only.
- Scale (size/line height): caption 11/16, label 12/16, body-sm 13/18, body 15/22 (was 14/20), heading3 17/24, heading2 22/28, heading1 28/34, display 32/40 (app only; 72 is marketing). Letter spacing: -0.008em at 17, -0.012em at 22, -0.015em at 28.
- No sizes off the scale. The existing `text-[9px]` `[10px]` `[16px]` `[28px]` `[40px]` `[52px]` escapes move onto the scale or get an `off-scale:` reason.

## Spacing, radius, shadows
- Spacing: 4, 8, 12, 16, 24, 32, 48. No other values.
- Radius ladder: control 10, card 16, sheet 20, pill 999 (avatars, floating buttons, chips only). Replaces the 8 values in use (`rounded-sm/md/lg/xl/2xl/full`, `[14px]`, `[min(...)]`).
- Shadows: `shadow-card` on cards that float over paper; none inside lists, none in dark. Overlays use `overlay`.

## Layout and breakpoints
Sidebar 260 / thread max 720 / side panel resizable. Breakpoints 640 (phone), 1024 (sidebar docks), 1440. Phone: single column, sidebar is a sheet. Safe areas respected on mobile.

## Components
- Button: variants default (ink), outline, ghost, text, destructive (soft), link; sizes xs 24, sm 28, default 32, lg 36, xl 48. Radius = control. States: hover (primary-hover), pressed (-1px, 0.98), focus (2px brand ring, 3px offset), disabled (primary-disabled). Marketing pill radius does not apply in the app.
- Input: height 32/36/48, card fill, border `input`, radius control; focus = brand ring; error = destructive outline and one line of text.
- Card: card fill, 1px border, radius card, padding 16. Approval card: header with chip (Allow / Ask / Deny in mono caps), one-line summary, then Allow, Deny, Always allow.
- Nav / sidebar: sidebar fill, bot rows 36 high, selected = brand-soft fill, unread = small brand pill.
- Modal / sheet: dialog fill, radius sheet, overlay; mobile uses native sheets.
- Chat: user bubble primary; bot bubble card with border; bot avatar 26 radius 8; thread max 720; composer pinned.
- Lists: 36 rows, hover accent, selected brand-soft.
- Mobile: native controls first (Expo UI, native sheets, menus, pickers); custom surfaces use StyleSheet with these tokens via `apps/mobile/lib/appearance`.

## Imagery and illustration
Bots are the illustration: the eight 256 characters, rounded-square tiles with their own colour. No stock photos, no gradients, no sparkles. Empty states use a bot, one line, one action.

## Motion
Fast 120ms, base 200ms, ease `cubic-bezier(.2,0,0,1)`. Bots may use the spring ease for their own idle and arrival motion only. Respect reduced motion: no loops, no translate.

## Voice and copy rules
Plain, short, second person. Say what the bot did or needs ("I need to place the order from your card."). Verbs on buttons (Allow, Deny, Send). No exclamation marks, no "AI-powered", no jargon in UI ("Computer", not "sandbox"). Treat every visible word as UI: remove before adding.

## Do and don't
- Do use semantic tokens; do keep one accent; do let bots carry colour.
- Don't hardcode hex (3 `bg-[#…]` remain today); don't use `accent` for brand; don't add a fourth button style; don't use pill buttons in the app; don't use brand teal for body text on paper.

## Where tokens live in code and how to use them
Source of truth: `packages/ui-tokens/src/index.ts` (typed `ColorTokens`, `WebColorTokens`, `darkTokens`, `lightTokens`, `webDarkOverrides`, `webLightOverrides`, `radii`), generated to `packages/ui-tokens/src/tokens.css` by `pnpm --filter @robots/ui-tokens generate`. The shared file is `packages/ui-tokens/src/tokens.css`. The robots-site repo gets the same token names in its own `public/tokens.css` in a separate PR; its `apps/www/src/styles/global.css` token block (card radius 20) is not yet on the shared tokens and moves in that follow-up. The Tailwind `@theme` map and type scale are in `packages/ui-web/src/styles.css`; mobile reads the TS palettes via `apps/mobile/lib/appearance`. Adopting the rest of Paper & Ink means changing existing values in `index.ts`, swapping `--font-sans`, and regenerating. Use Tailwind semantic classes (`bg-card`, `text-muted-foreground`, `bg-brand-soft`), never raw values. `--shadow-*` and `--radius-ctl|card|sheet|pill` are CSS variables for now; Tailwind classes for them arrive with the visual PR.
