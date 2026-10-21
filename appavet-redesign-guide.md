# Appavet → Reference Redesign Guide

A complete, screen-by-screen plan to restyle **Appavet (Pet Shop Dashboard)** to
match the reference "Retail Inventory" look.

This file is self-contained: hand it to Claude Code (or follow it yourself). It
**only changes the visual layer** — colors, type, spacing, components. No data, no
logic, no calculations change.

> Companion file: `design-system-spec.md` (the generic target system). This guide is
> the *applied* version, mapped onto your real screens.

---

## 0. The big shift (read first)

| | Current Appavet | Target (reference) |
|---|---|---|
| Theme | Dark navy / near-black | **Light** — light-gray page, white cards |
| Accent | Light blue (`~#5B9CF8`) | **Orange** `#FD3706` |
| Font | System / default | **Archivo** (Latin) + **Vazirmatn** (Persian) |
| Color count | Many (blue, green, red, amber, pink…) | Strict palette + a few functional colors |
| Cards | Dark, thin borders | White, `20px` radius, soft shadow |

You asked to match the reference, which is a **light** theme — so this guide defaults
to a full light conversion. If you'd rather keep dark (it's arguably better for a POS
tool used all day), see **§9 — Dark variant**: same orange identity, dark surfaces.

---

## 1. Design tokens

```css
:root {
  /* Brand (confirmed from reference) */
  --color-accent:     #FD3706;  /* primary: buttons, links, active states, key series */
  --color-ink:        #222026;  /* primary text, dark surfaces, dark bars */
  --color-neutral:    #DBDBDB;  /* muted fills, neutral card */
  --color-white:      #FFFFFF;

  /* Surfaces / text (recommended) */
  --color-bg:         #F4F4F5;  /* page background — light gray, NOT white */
  --color-surface:    #FFFFFF;  /* cards */
  --color-text:       #222026;
  --color-text-muted: #7A7A80;  /* labels, "last month", axis, sub-text */
  --color-border:     #ECECEE;  /* hairlines, table dividers */

  /* Functional (kept minimal, see §2) */
  --color-positive:   #1FA85B;  /* profit, positive deltas, healthy stock */
  --color-danger:     #DC2626;  /* destructive only: wipe, replace, delete, neg. values */
  --color-warning:    #E0A100;  /* low stock, "wholesale" tag — use sparingly */

  /* Categorical (for profit-allocation & multi-series charts, echoes the rose chart) */
  --cat-1: #222026;  /* ink   */
  --cat-2: #FD3706;  /* orange*/
  --cat-3: #8A6F5C;  /* brown */
  --cat-4: #B0B0B5;  /* gray  */

  /* Shape & depth */
  --radius-card: 20px;
  --radius-md:   12px;
  --radius-pill: 999px;
  --pad-card:    24px;
  --gap:         18px;
  --shadow-soft: 0 1px 2px rgba(34,32,38,0.04);
}
```

```css
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&display=swap');
/* keep your existing Vazirmatn import for Persian */
body{
  font-family: 'Archivo', 'Vazirmatn', system-ui, sans-serif;
  background: var(--color-bg);
  color: var(--color-text);
}
```

> **Persian text:** Archivo has no Persian glyphs. Apply `font-family: 'Vazirmatn'`
> to any element containing Farsi (customer names, product names, the RTL tables).
> Latin text, numbers, and currency keep Archivo. A simple approach: set
> `'Archivo','Vazirmatn'` as the global stack — the browser falls back to Vazirmatn
> per-glyph automatically.

---

## 2. Color-role mapping (the important part)

Your app has far more color roles than the reference's four. Don't try to force
everything into orange — that breaks the look. Map each *role* deliberately:

| Current role (where you see it) | New value |
|---|---|
| **Primary blue** — logo, `+ New Order`, `+ Add product`, active nav, order `#` links, active toggles (Cards/List, Jalali/Gregorian, Day/Week/Month/Year), "Today" outline, `Download backup` | `--color-accent` (orange) |
| **Profit green** — Profit values, customer Profit column, Available Cash, Order profits / Wholesale refunds, Highlights amounts, positive margins | `--color-positive` (keep green) |
| **Danger red** — Danger zone, `Wipe all data`, `Import (Replace)`, Expenses, **stock = 0** | `--color-danger` (true red, **not** the accent) |
| **Amber/low stock** — catalog stock `1`, `WHOLESALE` badge, calendar order badges | `--color-warning` (use sparingly), or neutral chip (see below) |
| **CAT / DOG tags** | Neutral gray pill (`--color-neutral` bg, ink text) by default; if you want them distinct, DOG = light gray, CAT = light gray + small dot |
| **Profit allocation series** (Personal / Storefront / Wholesale / Emergency, currently blue/green/yellow/pink) | `--cat-1..4` in order, OR add hatch patterns to distinguish without extra hues |
| **Profit-trend bars** (blue gradient) | `--color-ink` bars, with the single tallest bar in `--color-accent` (echoes the reference's one-highlighted-bar) |
| **Calendar `#` badges** (amber circles) | Small `--color-ink` pills, white text; use `--color-accent` only for "today"/selected |

**Principle:** orange is scarce. One primary action per screen, active toggles, and at
most one data series. If two things on a screen are orange, ask which one really earns it.

---

## 3. Global chrome (applies to every screen)

### 3.1 Page & layout
- Page background → `--color-bg` (light gray).
- Content padding → `24–32px`.
- Replace every dark card/panel with: white surface, `--radius-card`, `--shadow-soft`,
  `1px` `--color-border`.

### 3.2 Sidebar (left rail)
- Background → white (or `#FAFAFB`), right edge `1px --color-border`.
- Logo: keep the "A" mark but in an **orange** rounded square (`--color-accent`),
  white glyph, `--radius-md`. Title "Appavet" in ink, "Pet Shop Dashboard" in muted.
- Nav items: ink text, muted icons. **Active item** = light fill (`#F4F4F5`) or a
  subtle orange-tinted background + an **orange left indicator bar**, ink text, the
  icon tinted orange. (Mirror this to the right side if you go RTL — see §8.)
- `+ New Order` button → `--color-accent` fill, white text, `--radius-md`. This is the
  one big primary action; keep it orange.
- "Last backup: …" → `--color-text-muted`, small.

### 3.3 Header / page titles
- Page titles ("Dashboard", "Orders", "Profits"…) → ink, Archivo SemiBold, ~24–28px.
- Any top-right controls (toggles, `+ Add product`) follow §5 component rules.

---

## 4. Screen-by-screen changes

### 4.1 Dashboard
- **4 KPI cards** (Orders / Profit / Revenue this month / All-time profit): convert to
  white cards. Optionally adopt the reference's mixed-fill trick for visual rhythm —
  e.g. make **one** card `--color-ink` (dark) and one `--color-accent` (orange), the
  other two white/neutral. Label small + muted, big value in ink (or white on dark
  cards), sub-line muted.
- **Next to expire** list: white card; each row = product name (ink, Vazirmatn for
  Persian), Jalali·Gregorian dates muted. "Expires in N days" → right-aligned;
  color-code by urgency using `--color-danger` (soon) → `--color-warning` → muted.
- **Recent orders** cards: white cards, hairline border. Order `#` in accent, customer
  name ink. `Total:` ink, `Profit:` green. `CAT/DOG` & `WHOLESALE` → neutral/warning
  pills per §2. Selected card → `2px --color-accent` outline (replaces the blue outline).
- **Top customers** list rows: white, hairline dividers, amounts green, right-aligned.

### 4.2 Orders
- `Cards / List` toggle (top-right) → segmented pill, active = orange fill + white text
  (replaces blue). See §5.4.
- Search input + `All pets` / `All orders` selects → white, `--radius-md`,
  `1px --color-border`, muted placeholder, focus ring in accent.
- Order cards → same treatment as Recent orders above. Keep the grid; just restyle.

### 4.3 Calendar
- `Jalali / Gregorian` toggle and `Today` → segmented pill, orange active.
- `‹ Prev` / `Next ›` → ghost buttons (ink text, hover light fill).
- Grid: white cells, `1px --color-border`, day number ink, secondary date muted.
- **Today / selected cell** → `2px --color-accent` outline (replaces blue).
- **Order badges** (`#16`, `#23`…) → small ink pills, white text, `--radius-pill`;
  use accent only on the selected/today cell's badges.

### 4.4 Profits
- **Money paid** cards (Wholesale orders cost / Inventory cost): white cards. The little
  colored left-bar accents → map to `--cat-*`. Counts ("18 orders", "591 units") muted.
- **Cash balance**: big `Available cash` value → `--color-positive` (keep green, it's
  the hero number). Breakdown rows (Order profits, Wholesale refunds, External funding,
  Expenses) → white rows, hairline dividers, amounts right-aligned; positive green,
  `Expenses`/zero-negative in `--color-danger` or muted.
- **Profit allocation** 4 cards (Personal / Storefront / Wholesale / Emergency): keep
  the colored left-bar as the category indicator but recolor to `--cat-1..4`. `%` muted,
  value ink. The `Day/Week/Month/Year` toggle → orange-active pill.
- **Profit trend** bar chart: bars → `--color-ink`; tallest bar → `--color-accent`.
  Axis/grid lines → `--color-border`, labels muted. `Week/Month` toggle → orange-active.
- **Highlights** (High-volume customers / Highest-profit products): white cards,
  hairline rows, amounts green, names ink (Vazirmatn where Persian).

### 4.5 Catalog (Product Catalog table)
- `+ Add product` → orange button, white text.
- Table: white surface, header row muted uppercase labels, hairline row dividers.
- **Stock** cell: `0` → `--color-danger`; low (e.g. `1`) → `--color-warning`; healthy →
  ink. (This replaces the current red/amber, just retoned.)
- Margin `%` → ink (or green if you want to signal "good margin").
- Expires: Jalali bold ink, Gregorian sub-line muted; empty `YYYY/MM/DD` placeholder muted.
- `Save` → orange (or ink) button; `Delete` → ghost button with `--color-danger` text,
  red fill only on hover/confirm.

### 4.6 Customers (table)
- Same table styling as Catalog: white, muted header, hairline dividers.
- Persian names → Vazirmatn. Phone numbers (Persian digits) → keep as-is, muted-ink.
- **Profit** column → `--color-positive` (green). Spent → ink.
- `Delete` → ghost danger button.

### 4.7 Backup & Data
- Three white cards (Export / Import / Danger zone).
- `Download backup (.json)` → orange button.
- `Import (Merge)` → ink button; `Import (Replace)` → `--color-danger` button.
- `Choose File` → neutral outlined input.
- **Danger zone** card → `1px --color-danger` border, heading in danger red;
  `Wipe all data` → danger-red button. This is the one place red is correct and loud.

---

## 5. Components (shared rules)

### 5.1 Buttons
| Button | Style |
|---|---|
| Primary (`+ New Order`, `+ Add product`, `Download backup`) | `--color-accent` fill, white text, `--radius-md` |
| Secondary | white fill, `1px --color-border`, ink text |
| Ghost (Prev/Next, Save/Delete) | transparent, ink text, light hover fill |
| Destructive (`Wipe`, `Import (Replace)`) | `--color-danger` fill, white text |

### 5.2 Cards
White, `--radius-card`, `--pad-card`, `--shadow-soft`, optional `1px --color-border`.
Reserve `--color-ink` / `--color-accent` fills for KPI accent cards only.

### 5.3 Pills / tags / badges
- Default tag (CAT, DOG): `--color-neutral` bg, ink text, `--radius-pill`, ~12px.
- Status tag (WHOLESALE): `--color-warning` text on light-amber tint, or neutral.
- Count badge: `--color-ink` circle, white text.

### 5.4 Segmented toggles (Cards/List, Jalali/Gregorian, Day/Week/Month/Year, Week/Month)
- Pill container, `--radius-pill`, light track.
- Active segment: `--color-accent` fill, white text.
- Inactive: transparent, ink text.

### 5.5 Tables
- White surface, header row: muted uppercase labels, no heavy fill.
- Row dividers: `1px --color-border`, no zebra striping.
- Numeric columns right-aligned; positive green, destructive red, rest ink.

### 5.6 Inputs / selects
- White fill, `1px --color-border`, `--radius-md`, muted placeholder.
- Focus: `2px` accent ring (`box-shadow: 0 0 0 2px rgba(253,55,6,.25)`).

### 5.7 Charts
- Single-series bars → ink; highlight one bar in accent.
- Multi-series / allocation → `--cat-1..4` (add SVG hatch patterns if you need more
  separation without more colors — see the hatch snippet in `design-system-spec.md`).
- Gridlines `--color-border`, labels muted.

---

## 6. Implementation order (low-risk path)

1. **Tokens first.** Add the `:root` variables + font imports. Don't restyle anything
   yet — just define the system.
2. **Switch surfaces.** Page bg, card backgrounds, text colors, borders. The app will
   look "light but blue" at this stage. That's expected.
3. **Swap the accent.** Find every blue (`--color-accent` role in §2) and replace with
   orange. Now it reads on-brand.
4. **Functional colors.** Map green/red/amber per §2 (mostly already correct, just
   retoned).
5. **Components.** Buttons, pills, toggles, tables, charts.
6. **Per-screen pass.** Walk §4 screen by screen, fixing the specials (KPI accent cards,
   calendar badges, danger zone, profit allocation).
7. **Polish.** Radii, spacing, shadows, focus rings, Vazirmatn on Persian text.

> Tip: if your CSS uses hard-coded hex values today, the fastest route is a
> find-and-replace of each old hex → the matching token, then refine. Define tokens
> once and reference them so future tweaks are one-line changes.

---

## 7. Change checklist

- [ ] Add tokens (`:root`) + Archivo import; keep Vazirmatn for Persian.
- [ ] Page bg → light gray; all panels → white cards (`20px`, soft shadow).
- [ ] Every primary blue → orange `#FD3706`.
- [ ] Profit/positive → green; destructive → true red `#DC2626` (≠ accent).
- [ ] Stock states: 0 = red, low = amber, ok = ink.
- [ ] CAT/DOG/WHOLESALE → neutral/warning pills.
- [ ] Profit-allocation series → `--cat-1..4`; profit-trend bars → ink + 1 accent.
- [ ] Calendar badges → ink pills; today/selected → accent outline.
- [ ] All toggles → orange-active segmented pills.
- [ ] Tables → muted headers, hairline dividers, right-aligned numerics.
- [ ] Danger zone → red border + red buttons.
- [ ] Sidebar → white, orange logo, orange active indicator, orange New Order.
- [ ] (If RTL) apply §8.

---

## 8. RTL / Persian notes

Your data is heavily Persian; if the chrome should be RTL too:
- Set `dir="rtl"` on the root → sidebar moves to the **right**, active indicator bar
  flips to the right edge, header controls flip left.
- `text-align: right` for labels/table cells; numeric columns can stay aligned for
  scanning.
- Mirror directional icons (chevrons, Prev/Next, the ↗ arrows) — not the logo.
- Decide once: Latin vs Persian digits, and stay consistent.
- Colors/radii/components are direction-agnostic — no change.

If you keep the chrome LTR (as it is now) and only the data is Persian, you only need
the Vazirmatn font fallback — nothing else changes.

---

## 9. Optional — Dark variant (keep dark, adopt orange)

If you decide the light theme is too bright for daily POS use, keep dark surfaces but
take the orange identity. Same structure, different surface tokens:

```css
:root {
  --color-accent:     #FD3706;
  --color-bg:         #16151A;  /* deep ink-tinted bg */
  --color-surface:    #201E24;  /* cards */
  --color-text:       #F2F2F3;
  --color-text-muted: #9A9AA0;
  --color-border:     #2C2A30;
  --color-positive:   #38D27E;
  --color-danger:     #F26161;
  --color-warning:    #E0A100;
  /* radii / categorical / accent unchanged */
}
```

Everything else in this guide (orange primary, scarce accent, segmented pills, table
rules, color-role mapping) applies identically — only the surface/text tokens differ.
This keeps your current comfort while still matching the reference's *identity*.

---

*Confirmed from the reference: the four brand colors and Archivo. Values marked
"recommended/derived" complete a usable system — tune them against your real screens.*
