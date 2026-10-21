# Design System Spec — "Retail Inventory" Style

A complete, hand-off-ready specification of the look in the reference images.
Give this file to Claude Code (or follow it yourself) to restyle your app.

> **How to use this:** This document defines the *target* design. When you send
> screenshots of your current app, go screen by screen and apply the tokens and
> component rules below. Nothing here changes your app's logic — only its visual
> layer (colors, type, spacing, radii, components).

---

## 1. Design tokens

### 1.1 Colors

These four are the confirmed brand colors (from the branding board). The rest are
recommended derived values to make a full, usable palette.

| Token | Hex | Role |
|---|---|---|
| `--color-accent` | `#FD3706` | Primary accent: orange card, active toggles, primary actions, key data series |
| `--color-ink` | `#222026` | Near-black: dark cards, primary text, dark bars, "Export" button |
| `--color-neutral` | `#DBDBDB` | Light gray: the "Total Revenue" card, dividers, muted fills |
| `--color-white` | `#FFFFFF` | Card surfaces, text on dark/accent backgrounds |
| `--color-bg` | `#F4F4F5` *(inferred)* | Page background — a very light gray, **not** pure white |
| `--color-text-muted` | `#7A7A80` *(derived)* | Secondary labels: "last month", axis labels, table sub-text |
| `--color-positive` | `#1FA85B` *(derived)* | Positive deltas: `↗ +21%`, `↗ +79%`, green sale % |
| `--color-negative` | `#FD3706` | Negative deltas reuse the accent: `↘ 10%` |
| `--color-border` | `#ECECEE` *(derived)* | Hairline borders, table row dividers, input outlines |

```css
:root {
  --color-accent:       #FD3706;
  --color-ink:          #222026;
  --color-neutral:      #DBDBDB;
  --color-white:        #FFFFFF;
  --color-bg:           #F4F4F5;
  --color-text-muted:   #7A7A80;
  --color-positive:     #1FA85B;
  --color-negative:     #FD3706;
  --color-border:       #ECECEE;
}
```

**Rule of thumb:** the palette is monochrome (white / light gray / near-black) with
a single hot accent. Use orange sparingly — one card, the active toggle, and the
primary data series. If everything is orange, the look breaks.

### 1.2 Typography

| Property | Value |
|---|---|
| Family | **Archivo** (Google Fonts) |
| Fallback | `'Archivo', system-ui, -apple-system, sans-serif` |
| Numerals | Lining, tabular where possible (so `$14.085` columns align) |

Type scale observed in the reference:

| Use | Size (px) | Weight |
|---|---|---|
| KPI value (`$14.085`) | 32–36 | 700 (Bold) |
| Section / card title (`Total Orders`) | 16–18 | 600 (SemiBold) |
| Card label (`Total Customers`) | 14–15 | 500 (Medium) |
| Body / table cells | 14 | 400–500 |
| Caption / axis / "last month" | 12–13 | 400 |
| Delta badge (`+79%`) | 12 | 600 |

```css
@import url('https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&display=swap');
body { font-family: 'Archivo', system-ui, sans-serif; }
```

> **Persian / Farsi note (important for your apps):** Archivo has **no Persian
> glyphs**. For any Farsi UI keep **Vazirmatn** (which you already use) for Persian
> text, and use Archivo only for Latin text and numerals — or switch numerals to
> Vazirmatn too for consistency. See the RTL section (§6) before applying this to a
> Persian screen.

### 1.3 Radii

| Token | Value | Used on |
|---|---|---|
| `--radius-card` | `20px` | All dashboard cards |
| `--radius-md` | `12px` | Inner buttons, sidebar icon buttons, product thumbnails |
| `--radius-sm` | `8px` | Small chips, tooltips |
| `--radius-pill` | `999px` | Toggle groups, currency selector, header circles |

### 1.4 Spacing & elevation

- Card inner padding: **24px** (20px on smaller cards).
- Gap between cards: **16–20px**.
- Page outer padding: **24–32px**.
- Shadows are **very soft and subtle** — cards mostly separate by their fill color
  against the gray background, not by heavy drop shadows.
  Suggested: `box-shadow: 0 1px 2px rgba(34,32,38,0.04);`
- Borders are hairline (`1px`, `--color-border`), used on white circles and table rows.

```css
:root {
  --radius-card: 20px;
  --radius-md: 12px;
  --radius-sm: 8px;
  --radius-pill: 999px;
  --pad-card: 24px;
  --gap: 18px;
  --shadow-soft: 0 1px 2px rgba(34,32,38,0.04);
}
```

---

## 2. Layout structure

```
┌────────────────────────────────────────────────────────────────────┐
│  [logo] Retail Inventory                  [USD ▾] [🔍] [🔔²] [avatar] │  ← top bar
├──────┬─────────────────────────────────────────────────────────────┤
│      │  ┌────────┐ ┌────────┐ ┌────────┐   ┌──────────────────────┐ │
│ side │  │ Orders │ │ Custom.│ │ Revenue│   │   Top categories     │ │  ← KPI row + side card
│ bar  │  │ (dark) │ │(orange)│ │ (gray) │   │   (rose/pie chart)   │ │
│      │  └────────┘ └────────┘ └────────┘   └──────────────────────┘ │
│ icon │  ┌─────────────────────────────────┐ ┌──────────────────────┐ │
│ rail │  │  Total Orders (bar chart)       │ │  Sales by country    │ │  ← main chart + side card
│      │  │                                 │ └──────────────────────┘ │
│      │  └─────────────────────────────────┘ [ Export statistics ]    │
│      │  ┌─────────────────────────────────────────────────────────┐ │
│      │  │  Product sales (table)                                  │ │  ← table
│      │  └─────────────────────────────────────────────────────────┘ │
└──────┴─────────────────────────────────────────────────────────────┘
```

- **Left rail:** ~64px wide, white, vertical stack of icon buttons. Active item is a
  **dark filled rounded square** (`--color-ink`, white icon); inactive are plain
  outline icons. A small group (settings, logout) sits pinned lower / at the bottom.
- **Main area:** a 2-column feel — a flexible left column of primary content, and a
  narrower right column for the two "side" cards (Top categories, Sales by country).
- Generous whitespace; the gray page background shows between cards.

---

## 3. Components

### 3.1 KPI cards (the three at the top)

Three cards, each a different fill, same internal anatomy:

| Card | Background | Text | Mini-viz |
|---|---|---|---|
| Total Orders | `--color-ink` (dark) | white | smooth **area/line sparkline** (white line), floating `$1210.6` white pill tooltip |
| Total Customers | `--color-accent` (orange) | white | **horizontal stacked bar** — 23% Men (white) / 77% Women (dark) with legend dots |
| Total Revenue | `--color-neutral` (light gray) | dark | **pixel/grid bar chart** Mon–Sun (matrix of small squares), dark pill tooltip |

Each card has:
- Small label top-left (`Total Orders`).
- Large value below (`$14.085`).
- A delta badge next to / under it: `↗ +79%` green, or `↘ 10%` orange, with a tiny
  arrow icon.
- A muted "last month" comparison line (`$15.650 last month`).
- A small **sliders/settings icon** top-right.

### 3.2 Side cards

- **Top categories:** a **Nightingale rose / segmented donut** chart. Segments use
  *different fills as the encoding*: solid black, solid orange, gray, brown, and
  **diagonal-hatch patterns**. Percentages sit on the segments. Legend row below
  (colored dots + label). A pill toggle: `All time / Weekly / Monthly`.
- **Sales by country:** simple vertical **dark bars** with % labels above each bar
  (USA 25%, Japan 22%, UK 20%, Korea 18%, Spain 15%). Same pill toggle below.

### 3.3 Main bar chart (Total Orders)

- Vertical bars, Jan–Dec.
- Each bar is **two-tone**: a solid dark lower portion + a **diagonal-hatch (striped)
  upper portion** — the hatch reads as the "projected/return" part.
- One bar (Jun) is **highlighted** as a framed box split into `75%` (outlined/white,
  top) over `25%` (solid orange, bottom).
- **Tooltip:** dark rounded card — `Jun, 09` / `● Sold 30` (white dot) / `● Return 15`
  (orange dot).
- Legend top-right: `○ Income`  `● Profit` (orange dot). Filter/sliders icon beside it.

### 3.4 Toggles (segmented pills)

- Pill-shaped group, 3 segments (`All time / Weekly / Monthly`).
- Active segment: **orange fill, white text**. Inactive: transparent, dark text.
- Fully rounded container.

### 3.5 Buttons

| Button | Style |
|---|---|
| Primary / Export statistics | `--color-ink` fill, white text + upload icon, `--radius-md` |
| Active toggle | `--color-accent` fill, white text, pill |
| Header search / notifications | white **circle**, hairline border, dark outline icon |
| Currency selector | white pill, flag + `USD` + chevron |

### 3.6 Header controls (top-right)

`[ 🇺🇸 USD ▾ ]  ( 🔍 )  ( 🔔 ② )  ( avatar )`
- Currency = white rounded pill with flag.
- Search & bell = equal-size white circles with hairline border.
- Bell has a small **dark count badge** (`2`).
- Avatar = circular image.

### 3.7 Product sales table

| Item | Stock | Old price | Sale | New price | Items sold |
|---|---|---|---|---|---|
| 🖼 Jacquemus Largo | 118 | ~~$114.00~~ | **5%** (green) | $108.30 | 294 |

- Item cell = **rounded-square thumbnail** + product name.
- Old price muted; Sale % in `--color-positive` (green); New price bold/dark.
- Rows separated by hairline `--color-border` dividers. No zebra striping.
- A small "open" / arrow icon at the section's top-right.

### 3.8 Tooltips

- Dark (`--color-ink`) rounded rectangle, white text, `--radius-sm`.
- Multi-line with **colored dot indicators** per series.
- Small white "value pill" variant (`$1210.6`) with a pointer for sparklines.

### 3.9 Iconography

- **Outline / stroke** style, ~1.75px stroke, rounded joins, monochrome.
- Dark when active, muted gray when inactive.
- Per-card "sliders" icon for the settings affordance.

---

## 4. Chart styling cheat-sheet

| Chart | Library hint | Key styling |
|---|---|---|
| KPI sparkline | area line | smooth/monotone curve, 2px white stroke, faint fill, no axis |
| Customers split | stacked horizontal bar | 2 segments, rounded ends |
| Revenue grid | heatmap / matrix | small rounded squares, opacity by value, 7 columns |
| Main bars | bar | two-tone fill via SVG `<pattern>` diagonal hatch on top portion |
| Top categories | polar / rose (e.g. ECharts `roseType`) | per-segment pattern fills, labels on segments |
| Sales by country | bar | solid ink bars, value labels above |

**Hatch pattern (SVG)** — reuse everywhere the striped texture appears:

```html
<defs>
  <pattern id="hatch" width="6" height="6" patternTransform="rotate(45)"
           patternUnits="userSpaceOnUse">
    <rect width="6" height="6" fill="transparent"/>
    <line x1="0" y1="0" x2="0" y2="6" stroke="#222026" stroke-width="2"/>
  </pattern>
</defs>
<!-- usage: fill="url(#hatch)" -->
```

---

## 5. Tailwind config (optional, if you use Tailwind)

```js
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        accent:   '#FD3706',
        ink:      '#222026',
        neutral2: '#DBDBDB',
        bg:       '#F4F4F5',
        muted:    '#7A7A80',
        positive: '#1FA85B',
        bordr:    '#ECECEE',
      },
      borderRadius: { card: '20px', md2: '12px' },
      fontFamily: { sans: ['Archivo', 'system-ui', 'sans-serif'] },
      boxShadow: { soft: '0 1px 2px rgba(34,32,38,0.04)' },
    },
  },
};
```

---

## 6. Persian / RTL adaptation (for your Farsi apps)

The reference is English/LTR. To apply this to a Persian app:

1. **Font:** Vazirmatn for Persian text; Archivo (or Vazirmatn) for numerals. Keep
   the same weights/scale from §1.2.
2. **Direction:** set `dir="rtl"` on the root. Then:
   - Sidebar moves to the **right** edge.
   - Header controls flip to the **left**.
   - Charts read **right-to-left**; reverse category/axis order.
   - `text-align: right` for labels and table cells; numeric columns can stay aligned
     for readability.
3. **Numerals:** decide once — Latin (`14.085`) or Persian (`۱۴٬۰۸۵`) digits — and be
   consistent across every card and chart.
4. **Icons:** mirror directional icons (arrows, the "open" ↗), but **not** logos or
   symmetric glyphs.
5. **Spacing/radii/colors:** unchanged — they're direction-agnostic.

Everything else (tokens, components, charts) transfers as-is.

---

## 7. Change checklist (apply per screen)

When you send your current screens, work through this list on each one:

- [ ] Swap font family → Archivo (+ Vazirmatn for Persian).
- [ ] Replace background → `--color-bg` (light gray, not white).
- [ ] Convert containers → white cards, `--radius-card`, `--pad-card`, soft shadow.
- [ ] Recolor to the 4-color palette; remove any off-brand colors.
- [ ] Make the accent **scarce** — one card / active state / one data series.
- [ ] Rebuild KPI cards with the dark / orange / gray pattern + delta badges.
- [ ] Restyle charts (hatch fills, two-tone bars, rose chart, grid chart).
- [ ] Convert filters to orange-active **segmented pill toggles**.
- [ ] Header: currency pill + circular search/bell (with badge) + avatar.
- [ ] Left rail: icon buttons, dark-filled active square.
- [ ] Tables: thumbnail + name, green sale %, hairline dividers.
- [ ] Tooltips: dark rounded, dotted series indicators.
- [ ] (Persian apps) apply §6 RTL adaptation.

---

*Confirmed from references: the four brand colors and the Archivo typeface. Values
marked "inferred"/"derived" are recommended fills to complete a usable system —
adjust to taste once you see them against your real screens.*
