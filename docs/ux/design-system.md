# Team Dashboard design system

> **Cluster:** UX · **Tags:** design-system, tokens, components, layout, team-dashboard · **Related:** [index.css](../../ui/src/index.css), [in-app Design Guide page](../../ui/src/pages/DesignGuide.tsx), [status-colors.ts](../../ui/src/lib/status-colors.ts), [UX audit 2026-07-04](../ux-audit-2026-07-04.md); the YouTube area spec (`docs/ux/youtube-area-spec.md`) is its own change and is named here without a link until it lands

**v1 — owner decisions of 2026-10-10 applied.** First written 2026-10-09 as a draft; revised 2026-10-10 after the
owner answered the decision sheet (section 8). Nothing in `ui/` changes because of this file: it is the rulebook and
the plan. This is the public, trimmed version; the longer working draft, with its sources, is kept in a private note
outside this repository.

How to read the tags in this file:

- **V** means it was read in the named file, or the named command was run, on 2026-10-09 (or 2026-10-10 where it says so).
- **INFERRED** means it is a judgment, or a reading of code that nobody rendered in a browser.
- **UNVERIFIED** means it could not be checked. Section 11 lists them.
- **NEW** means a variable or component that does not exist yet. Nothing marked NEW is built.

No page was opened in a browser for this document. Every statement about what a page *does* on screen is a reading
of the code, except the one measurement recorded in section 4.5.

File names are written short. A page is in `ui/src/pages/`, a shared component in `ui/src/components/`, a primitive
in `ui/src/components/ui/`, and `index.css` is `ui/src/index.css`. Line numbers are a snapshot: the YouTube page
lines are pinned to `origin/master` at `b6188dc2` (after #202); the other lines were read at `dc8beabc` and none
of those files changed in #202.

---

## 0. In plain words

- The dashboard has good building blocks, but each page mixes its own colours, sizes and labels on top. The same
  status was green on one YouTube page and blue on the other.
- This document picks one look: black and coral, dark first, with a light theme kept.
- It lists every building block, when to use it, and what is not allowed.
- It names the building blocks the dashboard is missing, including a video player for the page where videos are
  approved.
- It lists where the pages break the rules today, with file and line, so the cleanup has a start list.

---

## 1. Purpose and rule of use

**What this governs.** The signed-in admin app under `ui/src`: every page that renders inside the shell in
`ui/src/components/Layout.tsx`.

**What it does not govern.** Three other looks live in this repo and stay as they are:

| Surface | Its own source | Why it is separate |
|---|---|---|
| Affiliate-facing pages: `ui/src/pages/Affiliate*.tsx`, **except** `AffiliateAdmin*.tsx`, which are admin pages inside the shell (`App.tsx:288-299`, V) and are governed here | `ui/src/lib/cdDesign.ts` and `ui/src/components/cd/CDPrimitives.tsx`. The file header says it mirrors the storefront's design file (`cdDesign.ts:1-4`, V). | Outside people see them, on routes rendered outside the shell (`App.tsx:21`). They already use the same dark and coral hex values as section 3 (`cdDesign.ts:17-30`, V). |
| Public brand guide (`packages/brand-guide/index.html`) | Its own `:root` block: gold `#C9A84C` on black, Inter, JetBrains Mono (`index.html:13-34`, V). | It is titled "Coherence Daddy — Brand Guidelines" (`index.html:6`). Default taken, not asked (section 8): it is the public brand, separate from this tool, and is left alone. |
| Docs site colours (`docs/docs.json`) | Mintlify theme, blue `#2563EB` (V). | Not the app. |

**The rule.** This is the standing rule for UI work in this repo:

1. Before any change to a page, open this document and build from it.
2. A new component goes into the catalog first, then onto a page.
3. Tokens only. A page never names a raw colour.
4. No one-off styles. If the catalog cannot do it, the catalog changes first.
5. Every brief for UI work names the exact components and tokens it will use.

**The catalog is two places that must agree.**

| Place | Holds | Rule |
|---|---|---|
| This document | The rules, the token table, what is banned, the decisions | Changes first |
| The living page at `/design-guide` (`ui/src/pages/DesignGuide.tsx`, route in `ui/src/App.tsx:329`, V) | Every component rendered for real | Changes second, in the same pull request as the component |

The living page already says of itself: "This page should be updated when new UI primitives or app-level patterns
ship" (`DesignGuide.tsx:206`, V). It is behind: its coverage list names 21 primitives and `ui/src/components/ui/`
holds 22. `alert-dialog` is missing from the list (`DesignGuide.tsx:211-215`, V).

**Who must read it.** Any person or agent before touching `ui/src`. That includes the `front` and `ux` roles and any
reviewer of a UI pull request.

**Which source answers which question.**

| Question | Source that answers it |
|---|---|
| A brand value: a hex, a typeface | The token tables in section 3 |
| How team-dashboard builds something | This document |
| Whether an interaction makes sense | The standard UX laws (Hick, Fitts, Jakob, Miller, proximity and the rest). A review names the law that holds or fails; it never just calls a screen "clean" |
| A measured trap, found by running something | This repo's `CLAUDE.md`, with a one-line pointer here |

**A UI change is done when all five hold.**

1. It uses only catalog components and the tokens in section 3.
2. It has a loading, an empty and an error state (section 5.3).
3. The page does not scroll sideways at 1280, 1024, 768 and 390 pixels wide (section 4.5).
4. Every status shows a word, not only a colour (section 3.2).
5. `/design-guide` shows any component the change added.

---

## 2. Where the look comes from

The look follows the owner's other internal tools: black and coral, dark first. The detailed mapping from those
tools to the values below is kept in a private note outside this repository, and the values in section 3 are this
repo's own.

### 2.1 No summary strip on work pages (default taken, not asked)

A page whose job is to work a queue leads with the queue. A band of summary numbers above it pushes the work down
the screen, and on a page where the job is "approve the next video" that costs the thing you came for. So work pages
get no summary strip. The Dashboard page keeps its number tiles (`MetricCard`), because a summary is its job. The
owner was not asked this on the decision sheet; this is the draft's recommended default.

---

## 3. Tokens

**The rule: no raw hex in page code. Hex appears only in this section and in `ui/src/index.css`.**

Every existing variable keeps its name. Only values change, plus the NEW variables listed in 3.9.

How the numbers were made: a short script converted the `oklch()` values in `index.css` to hex (the "today" column)
and computed every contrast figure with the WCAG 2.x relative-luminance formula. All of it was recomputed on
2026-10-10 and matched, except the correction in 3.2. The script is a scratch file and is not in the repo, so
re-derive a figure before relying on it for a new colour.

Values in these tables are recommendations. The owner approved the look and the rule set as a whole (section 8)
and was not asked about individual values.

### 3.1 Colour roles

Dark is the default theme today: `ui/index.html:2` has `class="dark"`, and the start-up script uses dark unless a
choice was saved (`ui/index.html:29`, V). **Owner's choice (2026-10-10): keep both themes and open in dark.**

| Role | Dark value | Light value | team-dashboard variable | Today, dark / light |
|---|---|---|---|---|
| Page ground | `#0E0E10` | `#F8F7F4` | `--background` | `#0A0A0A` / `#FFFFFF` |
| Sidebar and rail ground | Same as the page; a line separates them | `#F8F7F4` | `--sidebar` | `#0A0A0A` / `#FAFAFA` |
| Card, panel, popover, dialog | `#18181B` | `#FFFFFF` | `--card`, `--popover` | `#171717` / `#FFFFFF` |
| Well, hover wash, quiet fill | `#1F1F22` | `#EDEBE7` | `--muted`, `--secondary`, `--accent`, `--sidebar-accent` | `#262626` / `#F5F5F5` |
| Text | `#F2F1ED` | `#0E0E10` | `--foreground`, and with it `--card-foreground`, `--popover-foreground`, `--secondary-foreground`, `--accent-foreground`, `--sidebar-foreground`, `--sidebar-accent-foreground` | `#FAFAFA` / `#0A0A0A` |
| Secondary text | `#A1A1A6` | `#6B6B70` | `--muted-foreground` | `#A1A1A1` / `#737373` |
| Hairline between things | Text colour at 9% | Text colour at 10%, INFERRED | `--border`, `--sidebar-border` | `#262626` / `#E5E5E5` |
| Edge of a control | `#6B6B70` (see note 3) | `#6B6B70` | `--input` | `#262626` / `#E5E5E5` |
| Brand fill: the main button | `#FF6B4A` | same | `--primary`, `--sidebar-primary` | `#FAFAFA` / `#171717` |
| Label on the brand fill | `#0E0E10` | same | `--primary-foreground`, `--sidebar-primary-foreground` | `#171717` / `#FAFAFA` |
| Brand, pressed | `#E5553A` | same | NEW `--primary-press` | — |
| Brand, sheen corner | `#FD8A6F` | same | NEW `--primary-sheen` | — |
| Brand as text: links, the active tab | `#FF6B4A` | `#A8341C` | NEW `--primary-text` | — |
| Focus ring | Coral, 2px, 2px away | `#A8341C` | `--ring`, `--sidebar-ring` | `#525252` / `#A1A1A1` |
| Danger text | `#FF5A4F` | `#B42318` | `--destructive` (same value as NEW `--status-bad`) | `#FB2C36` / `#E7000B` |
| Label on a danger fill | `#FFFFFF` | `#FFFFFF` | `--destructive-foreground` | see note 5 |

Notes:

1. **`--accent` is not the brand colour.** In this theme `--accent` is the hover wash, used 294 times (grep count,
   V). The brand colour is `--primary`. Never use `bg-accent` to make something stand out.
2. **Coral is never text on a light ground.** It measures 2.63:1 on the light page ground and 2.82:1 on white
   (recomputed 2026-10-10). On the three dark grounds it passes: 5.84 to 6.84:1. So `text-primary` is banned in
   page code and `text-primary-text` replaces it. Today `text-primary` appears 59 times in 33 files and
   `border-primary` 27 times in 20 (grep counts, V). Those move when `--primary` becomes coral, or light mode fails.
3. **Control edges.** A border that is the only sign of a control needs at least 3:1 against its ground. Today's
   `--input` is 1.18 to 1.31:1 on the dark grounds (V). An edge drawn at 16% of the text colour would reach only
   1.51 to 1.61:1 there. The mid grey `#6B6B70` clears 3:1 on all six grounds (3.10 to 5.30:1, recomputed 2026-10-10), so no new
   colour is needed. Hairlines between things stay quiet.
4. **The label on coral is dark, not white.** The dark ground colour on coral is 6.84:1. White on coral is 2.82:1.
5. **A mistake in the current file.** Light `--destructive-foreground` is set to the same red as `--destructive`
   (`index.css:62-63`, V). No page uses it (`destructive-foreground`: 0 hits in `.tsx`, V).
6. **Danger fills use the mark, not `--destructive`.** `--destructive` must stay a text-safe red because 251 places
   use `text-destructive`. A white label on the dark danger text colour is only 3.08:1. So the `destructive` Button
   variant points at `--status-bad-mark` when it is rebuilt (INFERRED).
7. **Chart colours are not decided here.** `--chart-1` to `--chart-5` keep their names. The order of the series is
   UNVERIFIED and belongs to the first page pass that draws a chart.

### 3.2 Status colours

**The rule (owner's choice, 2026-10-10: five colours only).** Red is a problem. Yellow needs you. Green is done.
Blue is running, or is information. Grey is idle. A status colour is never the brand coral. A status is never shown
by colour alone: every one carries a word, and a problem or warning also carries an icon.

Each kind has five roles. *Text* reads on a page. *Mark* is a fill. *On* is the label on that fill. *Soft* is the
wash behind a box. *Edge* is its 1px border. The "warn" kind is the yellow one; its light-theme mark is an amber
orange because pure yellow fails contrast on white.

| Theme, kind | Text | Mark | On | Soft | Edge |
|---|---|---|---|---|---|
| light bad | `#B42318` | `#D92D20` | `#FFFFFF` | `#FEE4E2` | `#F04438` |
| light warn | `#93370D` | `#D96200` | `#1D1D1F` | `#FEF0C7` | `#D96200` |
| light good | `#067647` | `#067647` | `#FFFFFF` | `#DCFAE6` | `#079455` |
| light info | `#175CD3` | `#1570EF` | `#FFFFFF` | `#D1E9FF` | `#2E90FA` |
| dark bad | `#FF5A4F` | `#D92D20` | `#FFFFFF` | `#3A1512` | `#F04438` |
| dark warn | `#FFC53D` | `#FFC400` | `#0E0E10` | `#382B06` | `#FFC400` |
| dark good | `#32D583` | `#17B26A` | `#0E0E10` | `#0F2E1D` | `#17B26A` |
| dark info | `#53B1FD` | `#2E90FA` | `#0E0E10` | `#0E2540` | `#2E90FA` |

Variables, all NEW: `--status-bad`, `--status-bad-mark`, `--status-bad-on`, `--status-bad-soft`,
`--status-bad-edge`, and the same five for `warn`, `good` and `info`. Twenty in all. Grey needs none: it is
`--muted` for the fill, `--foreground` for the label and `--border` for the edge. Muted text on the light well
colour is 4.45:1, just under the 4.5:1 bar, so a grey label uses the text colour.

**Correction made on 2026-10-10.** The first draft said the text colours reach 4.78:1 "on all six grounds". That
was wrong: a dark-theme text colour on a light ground is not a pairing anyone uses, and it measures as low as
1.33:1. The figures that hold, recomputed: on the three grounds *of its own theme*, text is 4.78:1 or more and a
mark is 3.10:1 or more. The label on its mark is 4.57:1 or more. Text on its own soft wash is 4.79:1 or more.

**One map from status to kind.** Today `ui/src/lib/status-colors.ts` gives most statuses a hue of their own across
ten Tailwind colour families (lines 54-117, V). It has no entry for `processing` or `pending_review`, the two
statuses the YouTube pages add (grep, V). The owner chose five colours; the assignment of each status to a kind is
this document's:

| Kind | Statuses |
|---|---|
| good | active, achieved, completed, succeeded, approved, done, posted, published, live, reviewed |
| info | running, in_progress, publishing, processing, scheduled, todo, ready, new, in_review |
| warn | pending_approval, pending_review, revision_requested, paused, stale, timed_out |
| bad | failed, error, terminated, rejected, blocked, deprecated |
| neutral | idle, archived, planned, backlog, cancelled, canceled, draft, retired, dormant |

`pending` is left out on purpose. It means "waiting for you" on the Approvals page (`Approvals.tsx:69`) and, as far
as its grey colour tells, "waiting in line" on the YouTube page (`YouTubePipeline.tsx:47`, INFERRED). One word
cannot carry both. The rule: waiting on a person is *warn* and says who ("Needs your OK"). Waiting on the machine
is *neutral* and says "Queued". Each page pass settles its own `pending`. The task board's extra purple and teal
go away with this map (work item W3, section 10).

### 3.3 Type

**Faces.** Display is Archivo Narrow 700, uppercase. Text is Geist 400, 500 and 600. Labels and numbers are Geist
Mono 500. Today `index.css` defines no font at all, so the admin app uses the browser's system font (V: the only
`font-family` lines are `inherit` and two literal mono stacks at `index.css:473, 578`). `cdDesign.ts:77-93` already
loads Geist and Geist Mono from Google Fonts for the affiliate pages.

NEW variables: `--font-display`, `--font-sans`, `--font-mono`. Whether the files are self-hosted or come from
Google Fonts is a build decision. Self-hosting is better for a signed-in admin tool (INFERRED).

**Scale.** Sizes are Tailwind's named steps plus one new step. Usage today, counted by grep over `.tsx` (V):
`text-xs` 1,719, `text-sm` 1,487, `text-2xl` 122, `text-base` 101, `text-xl` 79, `text-lg` 73. Off the scale:
`text-[11px]` 223, `text-[10px]` 215, and 63 more across eleven other bracket sizes. That is 501 bracket sizes in
105 files.

| Role | Size | Class | Face and treatment |
|---|---|---|---|
| Page title, the one `<h1>` | 20px | `text-xl` | Display 700, uppercase (default taken, not asked) |
| Dialog and sheet title | 20px | `text-xl` | Display 700, uppercase |
| Section or card title | 16px | `text-base` | Geist 600 |
| Section label ("eyebrow") | 12px | `text-xs` | Mono 500, uppercase, tracking 0.14em |
| Body, table cell, button | 14px | `text-sm` | Geist 400; buttons 600 (500 today, `button.tsx:8`) |
| Caption, time, helper text | 12px | `text-xs` | Geist 400, secondary colour |
| Tiny label, count badge | 11px | NEW `text-2xs` | Mono 500 |
| Number in a tile | 24px | `text-2xl` | Mono 600, tabular figures |
| Text typed into a field | 16px on a phone, 14px from 768px up | `text-base md:text-sm` | Geist 400 (already so in `input.tsx:11`) |

Rules:

- **11px is the floor.** Nothing is 10px or 9px. Both round up to `text-2xs`.
- **No bracket sizes.** `text-[13px]` and its relatives are banned. NEW `--text-2xs: 0.6875rem` replaces the two
  largest groups. `cdDesign.ts:52` already uses that exact size for its mono label.
- **One tracking value for labels.** NEW `--tracking-label: 0.14em`. Today there are eleven (`tracking-wide`,
  `tracking-[0.18em]`, `tracking-[0.2em]` and eight more; grep, V).
- **Numbers are mono and tabular** so a column lines up.
- **Never uppercase an identifier.** A file name, an ID or an issue key is not a title.
- **A field is never `text-xs`** (see drift row 11).

### 3.4 Spacing

No new variables. Tailwind's 4px steps contain everything below.

**Allowed steps:** `0.5` 2px, `1` 4px, `1.5` 6px, `2` 8px, `3` 12px, `4` 16px, `5` 20px, `6` 24px, `7` 28px, `8`
32px, `10` 40px. Bracket spacing such as `p-[14px]` is banned (19 today, V). Step `7` is added for the 28px gap
before a form's main button.

**Rhythm: roomier (owner's choice, 2026-10-10).** The draft recommended a tighter rhythm for a daily work tool. The
owner chose roomier, against that recommendation, so the roomier values apply. The law of proximity still holds: the
gap between groups is larger than the gap inside a group.

| Between | Roomier (chosen) | Class | Tighter option (draft default, not taken) |
|---|---|---|---|
| Top-level blocks of a page | 32px | `space-y-8` | 24px, `space-y-6` |
| Parts inside one card | 16px | `space-y-4` | 16px |
| Rows in a list | 0, with a hairline; rows 48px tall | `divide-y`, `py-3` | rows 40px |
| Cards in a grid | 24px | `gap-6` | 16px, `gap-4` |
| Buttons in a row | 12px | `gap-3` | 8px, `gap-2` |
| Label and its field | 8px | `space-y-2` | 8px |
| One field group and the next | 20px | `space-y-5` | 16px, `space-y-4` |
| Last field and the main button | 28px | `pt-7` | 24px, `pt-6` |

Counts today, for scale: `space-y-6` 90 uses, `gap-2` 773 uses (grep, V). Moving to the roomier values is a
class-by-class change that belongs to each page pass (section 10), not to one sweep.

### 3.5 Radius

**What exists, and a trap.** `index.css:39-42` sets `--radius-sm` 6px, `--radius-md` 8px, `--radius-lg` 0 and
`--radius-xl` 0. Tailwind 4.1.18's own defaults for those four are 4, 6, 8 and 12px (`tailwindcss/theme.css:350-353`
in `node_modules`, V). So in this app `rounded-lg` and `rounded-xl` draw **square** corners, and `rounded-2xl`, which
the theme does not touch, draws 16px. "Large" is smaller than "small". Pages use `rounded-lg` 192 times and
`rounded-xl` 112 times (grep, V). Each author probably expected a curve (INFERRED). The `Card` primitive has no
radius class at all (`card.tsx:10`), so cards are square.

**Owner's choice (2026-10-10): rounded cards.** That makes the trap a named work item, **W1: set `--radius-lg` and
`--radius-xl` to 16px in `ui/src/index.css:41-42`** (section 10).

| Shape | Value | Variable |
|---|---|---|
| Badge, chip, pill, avatar, count | fully round | `rounded-full` |
| Button, field, menu item, small tile | 8px | `--radius-md` (no change) |
| Small inner piece, keyboard hint | 6px | `--radius-sm` (no change) |
| Card, panel, dialog, sheet, popover | 16px | `--radius-lg` (0 today) |
| Not a role | same as `lg` | `--radius-xl` (0 today) |

Rules: radius comes from this table, never from taste. Tags and chips are fully round. An inner corner is never
larger than the corner it sits in. `rounded-2xl`, `rounded-xs` and bracket radii (26 today) are banned.

**Blast radius.** Changing `--radius-lg` from 0 to 16px rounds 304 existing uses at once. That is the point, but it
is the most visible single change in this plan, so W1 ships inside the scoped trial of section 10, step 1, before it
reaches `:root`.

### 3.6 Elevation

Surfaces are flat: no shadow or glow anywhere on a card, panel, tile, row, button or field; focus is an outline and
edges are 1px borders. Coloured glows and coloured shadows on buttons are banned (`cdDesign.ts:10` bans them too).

Adapted, because this app has a light theme and floating layers:

| Layer | Rule |
|---|---|
| Card, panel, tile, row, button, field | No shadow. A 1px `--border` is the edge. Today `Card` has `shadow-sm` (`card.tsx:10`) and fields have `shadow-xs` (`input.tsx:11`). Both go. |
| Popover, dropdown, dialog, sheet, toast | One neutral shadow, NEW `--shadow-overlay`, so the layer lifts off a light page. Never coloured. |
| Focus | The ring from section 3.1. A shadow may never hide it. |

`shadow-*` classes appear 56 times in 39 files today, in six different sizes (V).

### 3.7 Motion

| Use | Value | Class |
|---|---|---|
| Hover, press, colour change | 100ms | `duration-100` |
| A thing opening or closing | 150ms (also Tailwind's default) | `duration-150` |
| A drawer or dialog entering | 200ms, the ceiling (the dialog here is already 200ms: `index.css:208`) | `duration-200` |
| Easing | ease-out | `ease-out` |

No new variables. Today the code also uses 300, 500 and 1000 (19 uses, V).

Rules: motion is quiet and never decoration. All of it is off under `prefers-reduced-motion`. The only allowed loop
is a loading skeleton or spinner. `animate-spin` appears 75 times today (V). Section 5.3 says when a spinner is
allowed.

### 3.8 Layers, breakpoints, fixed sizes

**Layers.** No new variables, only Tailwind's steps, each with one job.

| Class | Job |
|---|---|
| `z-10` | A sticky header inside a scrolling list |
| `z-20` | The mobile top bar (`Layout.tsx:442`) |
| `z-40` | The mobile sidebar scrim (`Layout.tsx:317`) |
| `z-50` | Dialog, sheet, popover, dropdown, toast |

No new bracket layers. Three exist today (V). Two have a reason and stay: the toast, which must sit above a dialog
(`z-[120]`, `ToastViewport.tsx:86`), and the skip link (`z-[200]`, `Layout.tsx:306`). The third, `z-[9999]` on an
editor menu (`MarkdownEditor.tsx:567`), should come down to `z-50`. The 80 and 81 in `index.css:776-791` belong to a
third-party editor and stay.

**Breakpoints.** Tailwind's five only: 640, 768, 1024, 1280, 1536 (`tailwindcss/theme.css:279-283` in
`node_modules`, V). No custom pixel thresholds.

**Fixed sizes of the shell,** all V: company rail 72px (`CompanyRail.tsx:270`), sidebar 240px (`Sidebar.tsx:52`),
top bar 48px (`BreadcrumbBar.tsx:50`), properties panel 320px (`PropertiesPanel.tsx:16`), sheet up to 384px
(`sheet.tsx:65`). On a 1440px window that leaves about 1,080px for a page after the rail, the sidebar and the page
padding.

### 3.9 The NEW variables, in one list

| Group | Variables | Count |
|---|---|---|
| Status | `--status-{bad,warn,good,info}` and each with `-mark`, `-on`, `-soft`, `-edge` | 20 |
| Brand | `--primary-press`, `--primary-sheen`, `--primary-text` | 3 |
| Type | `--font-display`, `--font-sans`, `--font-mono`, `--text-2xs`, `--tracking-label` | 5 |
| Elevation | `--shadow-overlay` | 1 |
| **Total** | | **29** |

Existing variables whose values change: the colour set in 3.1, plus `--radius-lg` and `--radius-xl` (W1).

---

## 4. Layout rules

### 4.1 The app shell, as built

All V, read in the code.

- The page body never scrolls: `body { height: 100%; overflow: hidden }` (`index.css:125-129`).
- The shell is a full-height column (`Layout.tsx:301`). Left to right: company rail, sidebar, then a column holding
  the top bar and the page.
- **`<main id="main-content">` is the one scrolling box** (`Layout.tsx:448-453`). Its padding is 16px, or 24px from
  768px wide.
- On a phone the body scrolls instead and a bottom bar appears (`Layout.tsx:272-280, 453`).
- The top bar shows the page title when there is one breadcrumb (`BreadcrumbBar.tsx:68-77`) and a trail when there
  are several (`:83-110`).

Rule: a page never builds its own shell, its own scrolling box or its own outer padding.

### 4.2 The page header

**Every page starts with one `PageHeader`** (NEW, section 5.4). It holds, in this order:

1. **Title.** One `<h1>`, what the page is, two or three words.
2. **One line of purpose.** A plain sentence that says what you do here. No jargon.
3. **One main action**, on the right, if the page has one. Never two.
4. Optional: a small `HelpTip`, and lesser actions as outlined buttons or in a menu.

Why it is needed, measured at `dc8beabc` (V):

- 88 page `<h1>`s carry ten different size and weight combinations. The largest groups are `text-xl font-semibold`
  37, `text-lg font-semibold` 16, `text-2xl font-bold` 15 and `text-2xl font-semibold` 9. The living catalog
  documents `text-xl font-bold` (`DesignGuide.tsx:282`), which 2 of the 88 use.
- The title is often printed twice. The top bar already renders an `<h1>` for a one-breadcrumb page
  (`BreadcrumbBar.tsx:74`). `/socials/youtube` then shows three: the top bar's, "Socials & Content"
  (`SocialsContentLayout.tsx:101`) and "YouTube Pipeline" (`YouTubePipeline.tsx:493`).

Rule: **one `<h1>` per page, and it is the `PageHeader`'s.** The top bar shows where you are, not a second title; a
page that sets two or more breadcrumbs gets a trail there and no `<h1>` of its own from the bar. A section that owns
tabs, such as Socials & Content, gets one `PageHeader` and one tab row. The page inside adds no second title.
**One exception, by the owner's decision (2026-10-10):** a tab of such a section that has views of its own may add
**one second-level tab row**, in the quieter `pill` variant of `PageTabBar` (section 5.2), directly under the
section's row. The YouTube area is the first (section 9). Today `/socials/youtube` has two tab rows built two
different ways (`SocialsContentLayout.tsx:106-108` and the hand-built `YouTubePipeline.tsx:525-543`).

### 4.3 Content width

At least seven different page wrappers exist today: `max-w-2xl` to `max-w-5xl`, some centred, some not, some with
their own `p-6` on top of the shell's padding (grep, V). Examples: `Inspiration.tsx:225`, `DailyBrief.tsx:222`,
`SocialsContentLayout.tsx:99`, `DesignGuide.tsx:192`.

Rule, two widths, both starting at the left edge (default taken, not asked):

| Width | For | Class |
|---|---|---|
| Wide (the default) | Lists, queues, tables, dashboards, review pages | Fills the pane, capped with `max-w-screen-2xl` |
| Reading | Forms, settings, one document | `max-w-3xl` |

Left-aligned, not centred, so the left edge of the content does not move from page to page when the properties
panel opens (INFERRED). A page never adds padding around itself. The shell supplies it. Socials & Content still adds
its own `p-6` today (`SocialsContentLayout.tsx:99`); removing that double layer is part of its page pass.

### 4.4 Grid and density

- **Number tiles:** `grid grid-cols-2 lg:grid-cols-4 gap-6`. When four do not fit, they go two by two, never four
  squeezed.
- **Card grids:** `gap-6`, with two or three columns from 1024px.
- **Every grid track can shrink.** Tailwind's `grid-cols-N` already uses `minmax(0, 1fr)`. A hand-written track must
  say `minmax(0, 1fr)`, never a bare `1fr`: a bare `1fr` track will not shrink below its content and pushes the page
  wider.
- **Density: roomier (owner's choice, 2026-10-10).** The draft recommended tighter. The roomier values apply, as
  listed in 3.4. List rows are about 48px tall: `EntityRow` is `px-4 py-2 text-sm` today, about 40px
  (`EntityRow.tsx:30`), and becomes `py-3`. A button is 40px (`default`) for the actions of a card or row; `sm`
  (36px) is for a dense toolbar only (`button.tsx:24-33`). A field is 36px (`input.tsx:11`). On a touch screen every
  control is at least 44px, already in `index.css:147-160`. Roomier means fewer items per screen, so a list that
  needs to show many rows paginates by "Show more" (section 6) rather than by shrinking its rows.
- **One card, one padding: 24px, set by the primitive.** The `Card` primitive pads 24px top and bottom and its
  content 24px at the sides (`card.tsx:10, 68`). Pages fight it: among the eight most common class strings on the
  313 `CardContent` uses there are five different padding overrides (`py-4`, `pt-0`, `p-4`, `pt-4 pb-3`, `p-0`;
  grep, V). A card whose content says `p-4` keeps the card's own 24px, so it has 40px of padding above and below and
  16px at the sides (INFERRED from the classes, not measured). With the roomier choice the primitive's 24px stands
  and pages stop overriding it.

### 4.5 No horizontal scrolling

**The rule: no page scrolls sideways, at any width from 390px up.** A wide thing scrolls inside its own box. The page
itself only moves up and down.

**One cause is fixed and measured.** The ten Socials tabs were 1,150px wide and pushed `<main>` 158px sideways in a
1280px window (the numbers are the ones in the code comment at `PageTabBar.tsx:38-39`, measured by the
orchestrator on 2026-10-09). After #202 let the tab row wrap, the push was 0px; that last figure is the
orchestrator's note and was not re-measured here.

**Causes visible in the code today.** All were read in the code. None was measured in a browser, so each is INFERRED
as a cause of the sideways movement the owner reported on 2026-10-09.

| # | Where | What the code does |
|---|---|---|
| C1 | `Layout.tsx:453` | `<main>` is `overflow-auto`, which scrolls on both axes. Anything inside that is one pixel too wide makes the whole page pan left and right. |
| C2 | `YouTubeVideos.tsx:198-199` | A mono file name sits in a flex row with no `min-w-0` and no `truncate`. A flex child will not shrink below its own text, and an unbroken name cannot wrap. |
| C3 | `YouTubePipeline.tsx:168-175` | The full YouTube address is printed as the link text with no `truncate` and no `break-all`. The title one line above it has `truncate` (`:166`). |
| C4 | `tabs.tsx:26, 65` with `SocialsContentLayout.tsx:40-49, 106-108` | **Fixed in #202** for the page-level row: a tab list is `inline-flex w-fit` and every tab `whitespace-nowrap`, but `PageTabBar` now wraps (`PageTabBar.tsx:40-46`). Any other hand-built row of tabs still has the problem. |
| C5 | `SocialsContentLayout.tsx:99`, `Inspiration.tsx:225`, `DailyBrief.tsx:222` | A page adds its own `p-6` inside the shell's padding, leaving 48px less room. |
| C6 | 77 `w-[Npx]` and 17 `min-w-[…]` in `.tsx` (grep, V) | Fixed pixel widths that do not give way in a narrow pane. |
| C7 | 43 files contain a `<table>` (grep, V) | A table is as wide as its columns. Unless it is wrapped, the page scrolls instead of the table. |

**The rules that prevent them.**

1. **The page scrolls one way.** `<main>` scrolls up and down only. Clipping sideways overflow at the shell is a
   safety net, not the fix: a page "fixed" only by clipping can leave a table with columns nobody can reach. Each
   page must fit on its own.
2. **Every flex child that holds text gets `min-w-0`.** Otherwise it cannot shrink.
3. **Every piece of text someone else supplied is truncated or broken on purpose:**
   - Titles and names: `truncate`, with the full text available on hover and to a screen reader.
   - File names, paths, addresses, IDs, hashes: `break-all`, or `truncate` when a copy or open control sits beside
     it. `VideoEdit.tsx:272, 281` already does this.
   - Free text from a model or a person: `break-words`.
4. **A row that starts with supplied text and ends with controls is a grid, never a wrapping flex row:**
   `grid-template-columns: minmax(0, 1fr) auto auto`. A flex item's base size is its whole text width, so a long name
   pushes the controls onto a line of their own.
5. **A table scrolls inside its own box.** Wrap it in `overflow-x-auto`. A number column is right-aligned,
   `whitespace-nowrap` and tabular. A column is never narrower than its longest word.
6. **A row of tabs or chips either wraps or scrolls inside itself.** More than seven tabs is a design problem
   first: group them.
7. **No fixed pixel width on anything that holds text.** Use `max-w-*` with `w-full`. A `select` is capped at its
   container.
8. **Media never exceeds its box:** `max-w-full` on every `img`, `video` and `iframe`, inside a box with a set
   aspect ratio.
9. **The check.** For each page at 1280, 1024, 768 and 390px wide, `main.scrollWidth` must not exceed
   `main.clientWidth`, with real long data: a 90-character file name, a full address, forty rows.

---

## 5. Component catalog

Columns: what it is for, the variants allowed, its states, and what is banned.

### 5.1 Primitives (`ui/src/components/ui/`)

| Primitive | Use it for | Variants allowed | States | Banned |
|---|---|---|---|---|
| `button` | Any action | `default` (the one main action), `outline` (the rest), `ghost` (inside a row or toolbar), `destructive`, `link`. Sizes `default`, `sm`, `xs`, `icon`, `icon-sm`, `icon-xs` (`button.tsx:11-34`) | hover, focus ring, disabled, **pending**: label stays, a small spinner leads, the button is disabled | A second `default` in one view. A colour class on a button (`ApprovalCard.tsx:77`). An icon-only button with no `aria-label` (`YouTubePipeline.tsx:229-245, 265-273`). A disabled button that does not say why. New uses of `secondary` (4 buttons use it today, grep, V): `outline` is the quiet button |
| `badge` | A small label that is **not** a status: a count, a mode, a tag | `outline`, `secondary` (`badge.tsx:11-24`) | static | `Badge` with a colour class to show a status (`YouTubeVideos.tsx:208-217`, `VideoEdit.tsx:46`). Use `StatusBadge` |
| `card` | A group of related content with an edge | One padding, 24px (section 4.4). Parts: header, title, description, content, footer | static; hover edge only when the whole card is a link | Padding overrides. A shadow. A card inside a card. A card around a single line of text |
| `tabs` | Views of one thing | `line` for page level, through `PageTabBar`; `default` (pill) for the one allowed second-level row (section 4.2) and inside a card | active, hover, focus | A hand-built tab row (`YouTubePipeline.tsx:525-543`). Tabs inside tabs, other than the one allowed second-level row. More than seven |
| `input`, `textarea`, `label` | Typing | default; `aria-invalid` for an error (`input.tsx:13`) | focus, disabled, invalid with one line saying what to fix | A raw `<textarea>` or `<input>` (`VideoEdit.tsx:158, 184`). A field with no visible `Label`. Placeholder text as the label. `text-xs` on a field |
| `select` | Choosing one of a few | default and small trigger | open, disabled, placeholder | A raw `<select>`: 58 in 34 files today (V). The 2026-07-04 audit made the same ruling (`docs/ux-audit-2026-07-04.md`, A1 to A4) |
| `checkbox` | On or off | default | checked, disabled, focus | A raw `<input type="checkbox">` (`VideoEdit.tsx:184-188`) |
| `dialog` | A task that needs focus: a form, a detail | default width; wider only for an editor | open, pending, error inside the dialog | A dialog for a yes or no question. Use `alert-dialog` |
| `alert-dialog` | Confirming something | through `ConfirmDestructive` (section 5.4) | open, pending, failed (stays open and says so) | `window.confirm` |
| `sheet` | A side panel that keeps the page visible | right side, up to 384px | open, closed | Two sheets open at once: one right-edge panel at a time. A hand-built slide-over |
| `popover` | A small panel on demand | default | open, closed | Load-bearing text that exists only in a popover |
| `tooltip` | The name of an icon-only control; the full text of a truncated value | default | hover, focus | A tooltip as the only copy of something the reader needs. It is unreachable by touch |
| `dropdown-menu` | The lesser actions of a row or page | default; a destructive item in danger text, last | open, disabled item | A menu holding the page's main action |
| `command` | The command palette, a searchable picker | default | empty ("No results"), loading | A second palette |
| `collapsible` | Hiding detail the reader may not need | With a chevron **and** a word | open, closed | Hiding an unfinished or failed thing by default |
| `breadcrumb` | Where you are, in the top bar | default | last crumb truncates (`BreadcrumbBar.tsx:95-97`) | A breadcrumb that links to a redirect (`YouTubeVideos.tsx:73` points at `/youtube`, which redirects, `App.tsx:305`) |
| `avatar` | A person or an agent | sizes as built | image, initials | — |
| `scroll-area` | A scrolling box **inside** a page: a log, a long menu | default | — | Wrapping a whole page in one |
| `separator` | A hairline between groups | horizontal, vertical | — | A separator where spacing alone would do |
| `skeleton` | The shape of what is loading | through `PageSkeleton` | — | The text "Loading..." in place of a skeleton |

### 5.2 Shared components (`ui/src/components/`)

| Component | Use it for | Notes and what is banned |
|---|---|---|
| `Layout` | The shell. Pages never touch it | Section 4.1 |
| `BreadcrumbBar` | The top bar | Shows the trail. It should stop being a second `<h1>` once `PageHeader` exists (section 4.2) |
| `PageTabBar` | The page-level tab row | Wraps onto a second line instead of widening the page (#202: `PageTabBar.tsx:40-46`). Becomes a `<select>` on a phone (`PageTabBar.tsx:21-35`). That `<select>` is raw and should be the `select` primitive. **Addition (NEW, work item W2):** an optional `variant` prop, `line` (today, the default) and `pill` (the muted segmented look `TabsList variant="default"` already draws: `tabs.tsx:30-33`), for the one allowed second-level row. `PageTabBar` hard-codes `line` today (`PageTabBar.tsx:41`) |
| `PageSkeleton` | Loading a whole page | Variants `list`, `issues-list`, `detail`, `dashboard`, `approvals`, `costs`, `inbox`, `org-chart` (`PageSkeleton.tsx:4-13`). 52 pages import it. Add a variant here, never a hand-built one |
| `EmptyState` | Nothing to show | Icon, one sentence, an optional action (`EmptyState.tsx:5-10`). 43 pages import it. Its action icon is always a plus (`:21`); that should be a prop. Banned: a bare `<p>` (`YouTubePipeline.tsx:105, 295, 354`); a hand-built copy (`Approvals.tsx:106-113`) |
| `StatusBadge` and `lib/status-colors.ts` | A status | **Exists** (`StatusBadge.tsx`, 15 lines; 16 pages import it). Its new contract is section 5.4 |
| `StatusIcon`, `PriorityIcon` | Issue status and priority, with a picker | Keep. Their colours move onto the status tokens. The task board's extra hues go (work item W3) |
| `PlatformBadge` | Which social platform | Platform hues are a registered data palette, not status (`status-colors.ts:162-172`). Keep them in the one file |
| `MetricCard` | A number tile | Exists; only 4 pages import it. Banned: hand-built tiles (`YouTubePipeline.tsx:497-522`, `YouTubeVideos.tsx:113-166`); a status colour on the number; an icon in a tinted square. Gains a 4px top accent and a mono number |
| `EntityRow` | One row of a list | Exists (`EntityRow.tsx`), used in 6 files. It becomes the row of `DataList` (section 5.4), 48px tall |
| `FilterBar` | The active filters, each removable | Used in one file. Its remove button has no label (`FilterBar.tsx:26-31`) |
| `FlowStepper` | The Create, Review, Queue, Posted map | Keep. Add steps only inside the component |
| `HelpTip` | One plain sentence of help beside a heading | Keep (11 files). Never the only place a rule is stated |
| `CopyText` | Copying a value | Use for IDs, paths and addresses beside a truncated value |
| `ToastViewport` and `useToast` | "It worked" or "it failed", after an action | Tones `info`, `success`, `warn`, `error` (`ToastContext.tsx:12`). Its own palette (`ToastViewport.tsx:7-19`) moves onto the four status kinds. Every action that changes something ends in a toast or a visible change (`docs/ux-audit-2026-07-04.md`, D1 to D3) |
| `ApprovalCard` | One approval | Keep. Its status colours (`:10-13`) and its green button (`:77`) move to tokens |
| `ErrorBoundary` | A page that crashed | Keep. It prints the raw error message (`:49`). See section 5.3 |
| `Identity`, `InlineEditor`, `MarkdownBody`, `CommentThread`, `CommandPalette`, `PropertiesPanel`, `Sidebar*`, `CompanyRail` | As named | Not read line by line for this document. Not redesigned here |

### 5.3 States every page must have

| State | What shows | Banned |
|---|---|---|
| Loading | `PageSkeleton` in the shape of the page. A spinner only inside a button that was just pressed | "Loading..." text: 25 in 19 page files today (V); `YouTubePipeline.tsx:103, 293, 352, 388` |
| Empty | `EmptyState`: what is missing and the one thing to do about it | A blank area. `return null` (`YouTubePipeline.tsx:389`) |
| Error loading | `Notice` (bad): one plain sentence, what to do, a Retry button | Nothing at all. The YouTube pages read only `data` and `isLoading`, so a failed load looks empty (`YouTubePipeline.tsx:65, 283, 307, 383`; `YouTubeVideos.tsx:78`). The server's raw message (`Approvals.tsx:103-104`) |
| Action failed | A toast (error), and the thing stays as it was | A silent failure. None of the YouTube actions has an error path (`YouTubePipeline.tsx:70-76, 133-150`) |
| Action worked | A toast (success) or a change you can see | Silence |
| Part of the page stale or offline | `Notice` (warn) at the top | A hand-built banner (`Dashboard.tsx:206-215, 227`; `VideoEdit.tsx:123-136`) |

### 5.4 NEW components (described, not built)

**PageHeader** — NEW.
*For:* the top of every page (section 4.2). *Parts:* title, one line of purpose, an optional `HelpTip`, one main
action, optional lesser actions, an optional tab row beneath. *States:* loading (a skeleton title line; the action
is disabled). *Banned:* an icon in a brand colour beside the title (`YouTubePipeline.tsx:492`); a second main
action; a title that repeats the breadcrumb. There is no shared page header today: each page builds its own title (88 `<h1>`s, section 4.2).

**StatusBadge, new contract** — component exists, contract NEW.
*For:* every status, everywhere. *Input:* a status key. *Output:* a pill with a `-soft` wash, a `-edge` border, the
**word**, and for *bad* and *warn* an icon before the word. *One map:* each key gives a kind (section 3.2) and a
plain label, so `pending_review` reads "Needs your OK". Today the badge prints the raw key with underscores swapped
for spaces (`StatusBadge.tsx:12`). *Variants:* pill, and a dot for tight rows; the dot always has the word beside it
or in a tooltip. *Unknown key:* the neutral kind with the key shown, so a new status is visible, never invisible.
*Banned:* any status-to-colour map in a page or component file. Section 7 lists them. *Check:* the map has a test
that every status the server can send has an entry (INFERRED).

**VideoPreview** (a general `MediaPlayer` is the same part with an audio mode) — NEW.
*For:* any place a video or audio file is reviewed, approved or listed.
**Rule: a review surface shows the thing being approved.** No approve or publish control without the preview in the
same card. *Parts:* a box with a set aspect ratio (16:9, 9:16 or 1:1, the three `VideoEdit.tsx:178-180` already
offers), the browser's own controls, a poster frame, and a mono line beneath with length, size and when it was made.
It never plays on its own. It is never wider than its box (section 4.5, rule 8). *States:* loading (a skeleton of
the same shape); file missing (`Notice` warn: "The video file is not on the server", with what to do); cannot play
(the reason, and a Download button); ready. *Order in a review card:* preview first, then the title and facts, then
the actions, so the eye meets the video before the buttons. *Today:* since #202 the YouTube queue card has a bare,
hand-styled `<video>` and a closed description drop-down (`YouTubePipeline.tsx:188-200`), fed by a stream route that
answers byte-range requests, so seeking works (`server/src/routes/youtube.ts:394-423`; its test asserts a 206 answer:
`server/src/__tests__/youtube-video-stream.test.ts:65-77`, read, not run). Videos are also played by hand-written
tags in two other pages (`ContentReview.tsx:718`, `socials/SocialsCompose.tsx:582`) and audio in one
(`content-hub/VoiceChip.tsx:97`), all under `ui/src/pages/`.

**ConfirmDestructive** — NEW wrapper over the existing `alert-dialog`.
*For:* every action that removes, disables or cannot be undone, and every action that goes public at once. *Says:* a
title that names the thing ("Remove this video?"), one sentence on what happens and whether it can be undone, a
cancel button that is the default focus and says what it keeps ("Keep it"), and a danger button that repeats the
verb ("Remove"). *Three levels* (default taken, not asked):

| Level | When | What |
|---|---|---|
| Undo | The server can put it back | No dialog. Do it, then a toast with Undo |
| Confirm | An ordinary delete, or an action that goes public | The dialog above |
| Type to confirm | It cannot be undone and it is big: a partner, a company, every agent at once | The dialog, plus typing the name before the button works |

*States:* pending (the button shows it; the dialog stays); failed (the dialog stays open and says why). The
reference is `Inspiration.tsx:171-195`, built that way after the 2026-07-04 audit's review round. *Banned:*
`window.confirm` and `confirm`. There are 14 call sites in 11 files today (section 7; 13 before #202 added one to
Publish Now). A red icon as the only warning (`YouTubePipeline.tsx:272`).

**DataList and its row** — NEW container; the row is today's `EntityRow`.
*For:* any list of things with actions: videos, queue items, jobs, approvals. *Container:* an optional header
(count, search, filters, sort), then the rows, then "Show more" past a set number in place of pages. It owns its
three states (section 5.3). *Row:* a grid of `minmax(0, 1fr) auto auto` (section 4.5, rule 4): a leading icon or
thumbnail; the title, truncated; one meta line in secondary text; then the status; then the actions. Actions sit in
the row they act on: at most one visible button and a menu for the rest. Rows are 48px (section 4.4), separated by a
hairline, with no card around each row. *Banned:* one `Card` per row (`YouTubePipeline.tsx:108-122`,
`YouTubeVideos.tsx:187-240`); a link wrapped around a button (`YouTubeVideos.tsx:224-235`; use the button's
`asChild`); status badges hidden on narrow screens (`YouTubeVideos.tsx:207`), because a status must always be
readable.

**Notice** — NEW.
*For:* a message that stays on the page. *Kinds:* `bad`, `warn`, `good`, `info` and plain, each with its `-soft`
wash, `-edge` border and a filled icon whose shape differs by kind, so it does not rely on colour. *Parts:* an
optional title, the sentence, an optional button beneath. *Banned:* a hand-coloured box. Four exist in the pages
read (`Dashboard.tsx:206-215, 227`; `VideoEdit.tsx:123-136`; `ErrorBoundary.tsx:45-51`).

---

## 6. Working rules for every page

These rules were adjusted for an internal admin tool, and the owner accepted the adjusted set as a whole on
2026-10-10. Where a number matters it is in sections 3 to 5.

**Reading and deciding**

1. One main action per view. A second solid-coloured button in one view is a bug.
2. A row's action lives in that row: at most one visible button, and a menu for the rest.
3. Anything slower than about 400ms shows the shape of what is coming, not a blank and not a lone spinner.
4. Work that is unfinished or failed stays open and visible. It is never folded away by default.
5. A disabled control says why, in words beside it.
6. A count badge never shows for zero (`Approvals.tsx:90` already does this).
7. A flow ends by saying what happened and what comes next.
8. "Nothing here" always says so and gives the reason. A blank area is a bug.
9. Anything an AI wrote that a person has not yet approved says so on its card, and that wording is never cut for
   space.
10. Destructive actions keep their friction: the dialog names the thing and says whether it can be undone, and the
    copy is not softened to save words.
11. Internal names never reach a page as its main text: raw enum values, environment variable names, table or model
    names. A status always gets a plain label. Setting names may appear on Config and health pages, in a code chip,
    because the reader there is the operator.
12. A failed call shows one plain sentence, never the server's raw text.
13. One filter mechanic. Long lists use "Show more" in place of pages.
14. A `collapsible` shows a chevron and a word.

**Components**

15. One badge implementation: `StatusBadge` for a status, `Badge` for the rest.
16. One notice box (`Notice`), four kinds, each an icon plus colour.
17. One empty state (`EmptyState`), one steps component (`FlowStepper`), one side panel (`sheet`, one open at a time).
18. One enhanced `select`, not the browser's.
19. Fields have an error state: `aria-invalid` and one line saying what to fix.
20. A tooltip is never the only copy of text the reader needs.
21. Icons come from one set (lucide). No arrows or ticks typed as text; `FlowStepper.tsx:84` types an arrow and hides
    it from screen readers, which is acceptable.
22. The destructive button is solid red; its quiet form is red text on nothing. A card does not show its kind by
    hue: card bands are neutral, and a tile's top accent is decoration from a fixed order, never a status.

**Look**

23. Every colour token is defined in both theme blocks (`:root` and `.dark`).
24. Coral is a fill, never text on a light ground; the text-safe twin is `--primary-text` (3.1).
25. The label on coral is dark (3.1, note 4). The main button does not change with the theme.
26. A border that is the only sign of a control clears 3:1 (3.1, note 3).
27. Status colours are the five of 3.2, never the brand coral, never colour alone.
28. Colours come from tokens only. An existing page is fixed by a script that swaps classes, then a person checks
    the page.
29. Data colours (chart series, platforms) are a separate registered palette, each in one file: `--chart-*` and
    `platformBadge`.
30. Faces by role; numbers tabular and mono; never uppercase an identifier (3.3).
31. Radius comes from the table (3.5); elevation, motion, layers and breakpoints from 3.6 to 3.8.
32. Inline `style` is the largest bypass of the system: 615 `style={{` in 60 files today (V). Allowed only for a
    measured, per-item value.

**Pages and access**

33. Page types: list or queue, detail, dashboard, settings, and **review queue**, because approving is this tool's
    main job. Wizards and sign-in are not redesigned here. Every page uses the page header.
34. Appearance: the toggle is Light or Dark (`ThemeContext.tsx:11`). Both are kept and the app opens in dark. Adding
    a "System" choice is a later, small change.
35. Reading and approving must work on a phone. The org chart and the knowledge graph may be desktop-first, with a
    note saying so.
36. Touch targets are 44px, scoped to phones and touch pointers (already in `index.css:147-160`).
37. Decorative icons are silent to a screen reader (`aria-hidden`); an icon on its own has an `aria-label`.
38. Keyboard: focus stays inside an open panel, Escape closes it, and focus returns to the trigger. The Radix
    primitives give this, so there are no hand-built overlays.
39. A hovered link uses the text-safe colour.

**Enforcement**

40. One small automated check over `ui/src` freezes the counts in 7.1; a count may only shrink. No browser test
    suite yet.
41. `/design-guide` is the living component page and changes in the same pull request as a component.

---

## 7. Drift found today

Read on 2026-10-09 at `dc8beabc`. The YouTube lines were re-pinned on 2026-10-10 to `b6188dc2` (#202); every other
line is a snapshot.

### 7.1 Counts across `ui/src`

All by `grep` over `.tsx` and `.ts`, run on 2026-10-09 (V), except `confirm(`, which was re-run on 2026-10-10. Every
`Affiliate*` file is included in a count unless it says otherwise.

| What | Count |
|---|---|
| Raw Tailwind palette classes such as `text-zinc-400` or `bg-green-500/10` | 2,584 in 127 files. 222 of those are the shared `status-colors.ts` map. 1,771 are in `pages/`, of which 238 are in `Affiliate*.tsx` files |
| Bracket font sizes such as `text-[11px]` | 501 in 105 files |
| Hex colours typed in code | 387 in 47 files; 204 of them in `Affiliate*`, `cd/` and `cdDesign` files |
| Text dimmed by opacity (`text-muted-foreground/50` and similar) | 103 |
| `confirm(` and `window.confirm(` | 14 call sites in 11 files (13 before #202 added the Publish Now confirm) |
| Raw `<select>` | 58 in 34 files |
| "Loading..." text in pages | 25 in 19 files |
| Different size and weight combinations on a page `<h1>` | 10 across 88 headings |
| Different page wrappers (width, centring, extra padding) | at least 7 |
| Local maps or functions named for status, colour, tone or severity, outside the shared map | 47 matched by pattern. Not every one is a colour map. The ones in the table below were read |
| Inline `style={{` | 615 in 60 files |

Heaviest pages by lines carrying a raw palette class: `SystemHealth.tsx` 91, `AgentDetail.tsx` 76,
`PartnerDashboard.tsx` 46, `ContentReview.tsx` 41, `PartnerDetail.tsx` 37, `TwitterDashboard.tsx` 30,
`AgentOps.tsx` 23, `YouTubePipeline.tsx` 22.

### 7.2 Examples, with file and line

Pages read in full: `YouTubePipeline.tsx`, `YouTubeVideos.tsx`, `VideoEdit.tsx`, `Approvals.tsx`. Read by targeted
search: `Inspiration.tsx`, `DailyBrief.tsx`, `Dashboard.tsx`, `socials/SocialsContentLayout.tsx`.

| # | Where | What | Breaks |
|---|---|---|---|
| 1 | `YouTubePipeline.tsx:42-57`, `YouTubeVideos.tsx:47-54`, `VideoEdit.tsx:38-47` | Three page-local status-colour maps in three sibling pages. They disagree with each other and with the shared map: *published* is blue in one and green in the other, *ready* green then blue, *scheduled* purple then yellow, *processing* yellow then purple | 3.2; StatusBadge |
| 2 | `YouTubePipeline.tsx:161-278` | The card where the owner approves a video had a title and a date and no player. Since #202 it has a bare `<video>` and a closed description drop-down (`:188-200`), hand-styled: a stopgap until `VideoPreview` exists | VideoPreview |
| 3 | `YouTubePipeline.tsx:269`, `:209` | `confirm("Remove this video from the queue?")`, and since #202 `confirm("Post this video publicly…")`. Twelve more: `AgentDetail.tsx:2249, 3230`, `ProjectProperties.tsx:444, 455`, `PartnerDetail.tsx:1137`, `InstanceSettings.tsx:190`, `ShopSharersAdmin.tsx:97`, `HouseAdsAdmin.tsx:230`, `AutoReply.tsx:358`, `CompanySettings.tsx:743`, `ApprovalDetail.tsx:315`, `WatchtowerAdmin.tsx:361` | ConfirmDestructive |
| 4 | `YouTubePipeline.tsx:65, 283, 307, 383`; `YouTubeVideos.tsx:78` | Queries read only `data` and `isLoading`. A failed load shows the empty message or nothing (`:389` returns `null`). No action has an error path (`:70-76, 133-150`) | 5.3 |
| 5 | `YouTubeVideos.tsx:198-199`; `YouTubePipeline.tsx:168-175` | A long mono file name and a full address with no way to shrink or wrap | 4.5 rules 2 and 3 |
| 6 | `socials/SocialsContentLayout.tsx:40-49, 99-108` with `YouTubePipeline.tsx:491-494, 525-543` | The ten-tab row **now wraps** (#202). Still open: under it a second title and a second, hand-built tab row; three `<h1>`s on one page | 4.2 |
| 7 | `YouTubePipeline.tsx:497-522`; `YouTubeVideos.tsx:113-166` | Hand-built number tiles with raw colours on the numbers (`text-blue-500`, `text-purple-500`, `text-red-500`) and on tinted icon squares. `MetricCard` exists | MetricCard |
| 8 | `ApprovalCard.tsx:77` | The Approve button is coloured by hand, `bg-green-700 hover:bg-green-600 text-white`, because no button variant exists for it. Default taken, not asked (section 8): approve buttons take the same main-button colour as every other | Button |
| 9 | `YouTubePipeline.tsx:54`; `StatusBadge.tsx:12` | The raw status key reaches the screen: `pending_review` is printed as written, or with the underscore swapped for a space | 3.2; rule 11 |
| 10 | `YouTubePipeline.tsx:103, 105, 293, 295, 352, 354, 388`; `VideoEdit.tsx:221-225` | "Loading..." text and bare-paragraph empty states. `YouTubeVideos.tsx:100, 181` does both correctly | 5.3 |
| 11 | `YouTubePipeline.tsx:227` | A date field forced to `h-8 … text-xs`: 12px text in a field | 3.3 |
| 12 | `YouTubePipeline.tsx:229-245, 265-273` | Three icon-only buttons (tick, cross, bin) with no label and no tooltip. The bin is red and is the only warning | Button |
| 13 | `YouTubePipeline.tsx:493` `text-xl font-semibold`; `YouTubeVideos.tsx:106` `text-2xl font-bold`; `VideoEdit.tsx:116` `text-2xl font-semibold` | Three sibling pages, three page-title styles | PageHeader |
| 14 | `VideoEdit.tsx:158, 173, 184` | Raw `<textarea>`, `<select>` and checkbox beside the catalog's `Input` | 5.1 |
| 15 | `Dashboard.tsx:206-215, 227`; `VideoEdit.tsx:123-136` | Hand-built warning boxes. `Dashboard.tsx:227` writes a gradient in raw `rgba()` | Notice |
| 16 | `Approvals.tsx:92-93, 103-104, 106-113` | A count pill in `text-[10px]` and raw yellow; the server's raw error message; a hand-built empty state | 3.3; 5.3 |
| 17 | `YouTubePipeline.tsx:32`, `VideoEdit.tsx:27` and five more pages | Each re-writes "5m ago". `lib/utils.ts:32` and `lib/timeAgo.ts:7` already do it | One formatter |
| 18 | `YouTubeVideos.tsx:108`; `VideoEdit.tsx:117-119` | "Assembled videos on VPS" and "Edit raw footage with browser-use/video-use": internal names as the page's one line of purpose | 4.2; rule 11 |
| 19 | `index.css:39-42` | `rounded-lg` and `rounded-xl` draw square corners (section 3.5). `MetricCard.tsx:18` and `FlowStepper.tsx:57` both ask for `rounded-lg` | 3.5; W1 |
| 20 | `DesignGuide.tsx:211-215, 282` | The living catalog omits `alert-dialog` and shows a page-title style that only 2 of 88 page headings use | Section 1 |

**A page that already does most of it right:** `Inspiration.tsx`. It uses `PageSkeleton` (`:262`), an error branch
(`:263-265`), `EmptyState` (`:270`), `StatusBadge` (`:143`) and a confirm dialog that stays open on failure
(`:171-195`). Use it as the model, apart from its own `p-6` and centring (`:225`).

---

## 8. Owner decisions — resolved 2026-10-10

The owner answered the decision sheet on 2026-10-10 (about 00:25 PDT). Five items below were not on the sheet; they
take the draft's recommended option and are marked.

| # | Question | Resolution | Source |
|---|---|---|---|
| 1 | The look | Black and coral, as the owner's other internal tools wear it. Answer: "Yes" | Owner |
| 2 | A summary strip on work pages | **No strip** on work pages; the Dashboard page keeps its number tiles (2.1) | **Default taken, not asked** |
| 3 | Dark and light | Keep both, open in dark. Answer: "Keep both, open in dark" | Owner |
| 4 | How tight | **Roomier**, against the draft's recommendation of tighter. Answer: "Roomier". Applied in 3.4 and 4.4 | Owner's choice |
| 5 | Status colours | Five only: red problem, yellow needs you, green done, blue running, grey idle. Answer: "Five only: red, yellow, green, blue, grey" | Owner |
| 6 | Corners | Rounded cards. Answer: "Rounded cards". Makes the radius trap (3.5) work item W1 | Owner |
| 7 | Page titles | Capital-letter (uppercase display) titles | **Default taken, not asked** |
| 8 | The Approve button | The same colour as every other main button | **Default taken, not asked** |
| 9 | Deleting things | A simple "Are you sure?" dialog for ordinary deletes and anything that goes public; type-the-name only for things that can never come back | **Default taken, not asked** |
| 10 | The adjusted rules (section 6) | Accepted as a set. Answer: "Accept that as a set" | Owner |
| 11 | The gold brand page | Still the public brand, separate from this tool, left alone | **Default taken, not asked** |
| 12 | Publishing this document | Publish a trimmed version. This is it | Owner |

---

## 9. YouTube area

The first area to be rebuilt on this system is YouTube. Its flow, layout and states are in the YouTube area spec
(`docs/ux/youtube-area-spec.md`, its own change). This document supplies the parts; the spec decides what goes where.
The owner's structural answers, all of 2026-10-10:

- **A tab inside Socials & Content**, not an item of its own in the left menu. The area lives at `/socials/youtube`.
- **Four views:** Review · Scheduled · Posted · Files & settings, as a second-level tab row (the one exception in 4.2).
- **Approve in one click** at the suggested time; it is the one main button on the review card.
- **Post now stays on the card, behind a confirm** that says it goes public at once.
- **Title and description are editable** before approving.

It is the first user of `VideoPreview`, `Notice`, `ConfirmDestructive`, the `StatusBadge` contract and the `pill`
variant of `PageTabBar`.

---

## 10. Rollout order and named work items

### Named work items

| # | Work item | Where | Why |
|---|---|---|---|
| **W1** | **Fix the radius trap:** set `--radius-lg` and `--radius-xl` to 16px (they are 0 today) | `ui/src/index.css:41-42` | The owner chose rounded cards. Until this is done `rounded-lg` and `rounded-xl` draw square corners (3.5) |
| W2 | Add the `variant` prop (`line`, `pill`) to `PageTabBar` | `ui/src/components/PageTabBar.tsx:41` | The YouTube area's second-level row (4.2, 5.2) |
| W3 | Collapse `status-colors.ts` to the five kinds and add `pending_review` and `processing` | `ui/src/lib/status-colors.ts:54-117` | The owner chose five colours (3.2) |
| W4 | Roomier spacing: `EntityRow` to `py-3`; stop `p-4` overrides on `CardContent` | `EntityRow.tsx:30`; `card.tsx:10, 68` | The owner chose roomier (3.4, 4.4) |

### Order

**Step 0: foundations, nothing looks different yet.** Add the 29 NEW variables beside the existing ones without
changing any existing value. Build the NEW components and show them on `/design-guide`. Add the one check that
freezes the section 7.1 counts.

**Step 1: try the look on one area before the whole app.** Changing `--primary` and the radius (W1) changes every
page at once. A safer order is to scope the new values to one area with a wrapper class, approve it there, then move
the values to `:root` and `.dark` (INFERRED; a build decision). The YouTube area is that area.

**Page order.** Every pass ends with the five-point check in section 1.

| Order | Area | Pages | Why here |
|---|---|---|---|
| 1 | **YouTube** | `YouTubePipeline.tsx` (`/socials/youtube`), `YouTubeVideos.tsx` (`/youtube/videos`) | The owner's report. Its flow and layout belong to the YouTube area spec. This document supplies the components and tokens; the spec decides what goes where |
| 2 | Video Edit | `VideoEdit.tsx` | A sibling with the same copied helpers and the same page-local status map |
| 3 | Socials & Content shell, then its review pages | `socials/SocialsContentLayout.tsx`, `ContentReview.tsx`, `socials/SocialsQueue.tsx` | The double title and the double padding; the other places where media is approved |
| 4 | Approvals | `Approvals.tsx`, `ApprovalDetail.tsx`, `ApprovalCard.tsx` | The owner's approval path |
| 5 | Daily landing pages | `Dashboard.tsx`, `Inbox.tsx`, `DailyBrief.tsx`, `Inspiration.tsx` | Seen every day. Two are already close |
| 6 | Health and operations | `SystemHealth.tsx`, `AutomationHealth.tsx`, `CronManagement.tsx`, `AgentOps.tsx` | The most raw colour per page |
| 7 | Agents and routines | `AgentDetail.tsx`, `Agents.tsx`, `Routines.tsx`, `RoutineDetail.tsx` | The largest files; two `confirm` sites |
| 8 | Partners, credit score, Watchtower, university admin | `Partner*.tsx`, `CreditScore*.tsx`, `WatchtowerAdmin.tsx`, `UniversityAdmin.tsx` | Page-local status maps and `confirm` sites |
| 9 | Settings | `CompanySettings.tsx`, `InstanceSettings.tsx`, `PluginSettings.tsx` | Forms; two `confirm` sites |
| 10 | Affiliate admin | `AffiliateAdmin*.tsx` | Six copies of a `STATUS_PILL` map (grep, V) |

Not in the rollout: the affiliate-facing pages and the public brand guide (section 1). Three of those
affiliate-facing pages carry their own `STATUS_PILL` map too.

---

## 11. What this document could not read or verify

- **Nothing was rendered.** No page was opened in a browser. Every overflow cause in section 4.5 (apart from the
  one measured fix), the card padding sum in section 4.4 and the square-corner reading in section 3.5 come from
  the code.
- **Counts in 7.1** (other than `confirm(`) were run on 2026-10-09 and not re-run; #202 touched four files.
- **The 47 pattern matches for page-local status maps** were not each opened. Only the ones cited in section 7.2 were
  read.
- **Shared components not read line by line:** `Identity`, `InlineEditor`, `MarkdownBody`, `CommentThread`,
  `CommandPalette`, `PropertiesPanel`, the sidebar files, `PriorityIcon`.
- **Chart colours and the light-theme hairline value** are INFERRED or left open (section 3.1, note 7 and the
  Hairline row).
- **A forced-colours (high-contrast mode) block is deferred.** ASSUMED that no user of this tool is on that mode;
  the owner can overturn. Known gap if it is ever needed: the primitives draw focus as a ring, which is a shadow
  (`button.tsx:8`), and that mode discards shadows.
- **The stream route's seeking** was verified by reading its test, not by running it (section 5.4).
- **Registered:** this document is listed under "Reference Docs" in the repo's root `CLAUDE.md`, next to the
  [YouTube area spec](youtube-area-spec.md), which landed in the same change.
