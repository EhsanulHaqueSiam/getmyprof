# Design

The approved direction is [docs/mocks/phase1.html](../mocks/phase1.html), with the Pipeline,
Vault and Writer screens in [outreach-vault.html](../mocks/outreach-vault.html). It follows T3 Code:
clean, keyboard-first, and powerful through the palette and the inbox sidebar rather than more
panes.

## Tokens

`apps/web/src/index.css` uses T3 Code's token names (`background`, `foreground`, `primary`,
`muted-foreground`, `accent`, `border`, `input`, `popover`, `success`, `warning`, `info`,
`destructive`) with its true-black values: `#000` canvas, `#f1f3f7` text, `#191a1d` hover, 8%
white hairlines, an indigo primary. Dark only. `components/ui` reads these names, which is why it
renders unchanged. The glass utilities (`surface-glass`, `dropdown-glass`) come from T3 Code
verbatim.

Thread status hues mean the same thing everywhere a thread shows up: `status-approval` (amber),
`status-input` (indigo), `status-working` (blue). Done has no hue: one white unread dot.

## Type

As in T3 Code, the root stays at the browser's 16px: `text-sm` is 14px, `text-xs` 12px,
`text-2xs` 11px, and body copy 13px. Nothing reads below 10px, so a 1080p screen at 1x (no
font smoothing on macOS) stays legible. Pixel sizes like the tables' 12.5px come from the mocks.
`apps/web/src/design.test.ts` keeps `font-size` off `html`.

## Components

`apps/web/src/components/ui` is T3 Code's coss ui kit on Base UI, copied with its MIT license
(`LICENSE.t3code`). Pick a `variant` or `size`; layout classes are fine, restyling is not. To add
a primitive, copy it from T3 Code's `apps/web/src/components/ui` (or `pnpm dlx shadcn add
@coss/<name>` with `components.json`), then add any custom utility it needs to `index.css`
(lint flags unknown classes). `spinner` is left out on purpose: see Motion.

## Motion

| Moment                         | Motion                                    | Timing              |
| ------------------------------ | ----------------------------------------- | ------------------- |
| Press                          | scale to 0.97                             | 100ms ease-out      |
| Hover a row                    | its actions fade in, its time fades out   | 120ms               |
| Settle, snooze, accept, reject | the row folds shut (grid rows 1fr to 0fr) | 220ms `ease-drawer` |
| Panel open or close            | it slides, the chat re-centers            | 240ms `ease-drawer` |
| A tool call lands              | fades up 4px                              | 160ms ease-out      |
| List add, remove, move         | `@formkit/auto-animate`                   | its default         |
| Working                        | a static label with elapsed time          | none                |
| Done                           | one white dot, no toast, no sound         | none                |

Nothing animates forever: no spinners, pulses, shimmer or `infinite` keyframes. They repaint
every frame on high-refresh displays. `gradcode/no-forever-animation` and
`apps/web/src/design.test.ts` enforce it. Reduced motion turns every transition off.

## The inbox sidebar

Threads that need you come first (Approval, Input, Done and unread). Working rows recede to
62% opacity. Settle and Snooze appear on hover; their shelves start collapsed, and the open
thread never vanishes behind one. A thread settles itself once nothing waits on you: every
proposal reviewed and no approval pending. Untouched threads auto-settle after 3 days.

## Copy

Minimal. No em dashes (`gradcode/no-em-dash-copy`). No decorative chrome or subtitle lines above
sections. State the fact, then the action.
