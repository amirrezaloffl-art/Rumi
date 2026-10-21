# Rumi (formerly Appavet) — Pet Shop Dashboard

Internal names (IndexedDB `appavet`, `appavet-*` localStorage keys, the `appavet: true` file marker) are kept so old data and backups still load.

A single-page dashboard for organizing pet-shop orders. No build step, no server. Every device keeps the full dataset in IndexedDB (works offline); when online, changes sync through a JSON file in a GitHub repository (`sync.js`). A password lock (`security.js`) guards the app. See README.md for setup.

---

## Tech stack

- **HTML / CSS / Vanilla JS** — no framework, no bundler.
- **IndexedDB** — local persistence (`db.js` wrapper).
- **Hash-based routing** — `#/dashboard`, `#/orders`, etc.
- **Custom Jalali ↔ Gregorian conversion** — `jalali.js`.
- **Custom canvas charts** — bar chart drawn directly on `<canvas>`.

---

## File map

| File | Purpose |
|------|---------|
| `index.html` | Page shell, sidebar nav, modals (order form, day-orders, confirm), toast. |
| `styles.css` | All styling — dark theme with CSS variables, responsive grid. |
| `app.js` | Routing, rendering for every page, order form logic, profit math, charts. |
| `db.js` | IndexedDB wrapper + customer/product/order upserts + JSON export/import. |
| `jalali.js` | Jalali / Gregorian date conversion, formatting, parsing, month grids. |
| `petshop.md` | Original spec the user wrote. |
| `PROJECT.md` | This document. |

---

## Pages (routes)

All routes live behind a `#/<route>` hash. Sidebar highlights the active one.

### 1. Dashboard (`#/dashboard`)
- 4 stat cards: orders this month, profit this month, revenue this month, all-time profit.
- "Next to expire" — products with the soonest expiry dates (top 5 + everything under 100 days).
- Recent orders (latest 6 cards).
- Top customers this month.
- Top products by profit and by units sold.

### 2. Orders (`#/orders`)
- Cards / List view toggle.
- Filters: text search (customer or product), pet (dog/cat), wholesale-only / retail-only.
- Click any order → opens the order form pre-filled for editing.
- Delete from list view (restores inventory).

### 3. Calendar (`#/calendar`)
- Month grid with both Jalali and Gregorian modes (toggle preserved in `meta`).
- Each day shows order numbers as colored circles (yellow = wholesale, blue = retail).
- Click a day → modal listing that day's orders + "add order on this day" button.
- Today is outlined with the accent color.

### 4. Profits (`#/profits`)
- **Money paid** (new): two cards
  - **Wholesale orders cost (refund)** — `Σ(cost × qty)` across wholesale-flagged orders.
  - **Inventory cost (catalog stock)** — `Σ(defaultCost × stock)` across all catalog products.
- **Profit allocation (all-time)** — 4 buckets:
  - Personal income 35%
  - Storefront 30%
  - Wholesale price increase 20%
  - Emergency & tax 15%
- **Profit trend** — bar chart, last 12 weeks or last 12 months.
- **Highlights** — high-volume customers + highest-profit products.
- **Best-selling products** by units.

### 5. Catalog (`#/catalog`)
Editable table of products. Columns:
- **Product** — name (also used to match lines in orders).
- **Stock** — current inventory. Red at ≤ 0, amber at < 5.
- **Default cost** / **Default sell** — pre-filled into order lines.
- **Default margin** — auto-computed from cost / sell.
- **Expires** — accepts Jalali or Gregorian; auto-detects which by leading digit (`2…` → Gregorian, otherwise Jalali). Shows the other calendar as a hint.

Adding a new line via "+ Add product" inserts a blank row at the top. Products are also auto-created the first time they appear in an order.

### 6. Customers (`#/customers`)
Auto-built from orders. Columns: name, phones, email, order count, spent, profit, last order. Sortable by spend (default).

### 7. Backup & Data (`#/settings`)
- **Export** — downloads `appavet-backup-YYYY-MM-DD.json` containing orders + customers + products + schema version.
- **Import (Merge)** — adds records with fresh IDs.
- **Import (Replace)** — wipes the local DB and loads the file.
- **Wipe all data** — danger zone.

---

## Order form

Modal with customer name (autocomplete), pet (dog/cat), date (Jalali ↔ Gregorian toggle), time, wholesale checkbox, two phones, email, shipping price, address, and a product table with rows of `name / qty / cost / sell / profit`. Customer auto-fill from prior orders. Product line auto-fills cost & sell from catalog when name matches.

Bottom totals: order profit (cost-vs-sell only), shipping, customer pays.

---

## Data model

### `orders` (IndexedDB store, autoincrement `id`)
```text
{
  id, customerId, customerName,
  pet: 'dog' | 'cat',
  date: 'YYYY-MM-DD',  time: 'HH:mm',
  isWholesale: boolean,
  phone1, phone2, email, address,
  shipping: number,
  products: [{ productId, name, qty, costPrice, sellPrice }],
  gifts:    [{ productId, name, qty, costPrice }],   // free items: take stock, cost reduces profit, unpriced on invoice
  profit: number,           // cached: Σ((sell − cost) × qty) − discount − Σ(gift cost × qty) − loss
  createdAt, updatedAt
}
```

### `customers` (autoincrement `id`)
```text
{ id, name, nameLower, phone1, phone2, email, address, createdAt }
```

### `products` (autoincrement `id`)
```text
{
  id, name, nameLower,
  defaultCost, defaultSell,
  stock,          // current on-hand inventory
  expireDate,     // ISO 'YYYY-MM-DD'
  createdAt
}
```

### `meta` (key/value)
- `calMode`: `'jalali' | 'gregorian'` — calendar preference.
- `lastBackup`: ISO timestamp of last export/import.

---

## Inventory tracking

- Stock is **derived, never stored**: `stock = Σ stockMoves.delta − Σ qty of product + gift lines in non-archived orders` (`DB.computeStock`).
- Catalog edits save the *difference* as a stock move ("Stock count", "Opening stock"), so concurrent edits/sales on two devices add up.
- Archiving an order returns its units automatically (archived orders are excluded); restoring takes them again.
- Products auto-created from an order line start with no moves (stock goes negative until counted).
- Upgrading from schema 2 turns each stored `stock` into an "Opening balance" move.

## Sync (sync.js)

- Records have unique time-based numeric `id`s and an `updatedAt` stamp; orders also have a sequential display number `no`.
- A sync downloads the file, merges per record (newest `updatedAt` wins; tombstones in `meta.tombstones` carry hard deletes), writes the merge locally in one transaction, and uploads it if it changed (409 → retry).
- Public repo (or "always encrypt") → file is AES-256-GCM encrypted with the password-derived key.

## Profit math

- **Per order**: `Σ((sellPrice − costPrice) × qty)` over its products. Shipping is **not** part of profit.
- **Per order total** (what customer pays): `shipping + Σ(sellPrice × qty)`.
- **Allocation buckets**: percentages from Settings (default Personal 50 / Wholesale 30 / Tax 20) applied to the selected period's profit.
- **Reports P&L**: shipping is shown as a memo (passed to the courier, not income) and gift cost is part of COGS, so "Order profit" equals the Profits page.
- **Wholesale cost (refund) card**: `Σ(costPrice × qty)` over orders where `isWholesale === true`.
- **Inventory cost card**: `Σ(defaultCost × stock)` over catalog products with `stock > 0`.

---

## Calendars (Jalali ↔ Gregorian)

`jalali.js` provides:
- `gregorianToJalali(date)` / `jalaliToGregorian(jy, jm, jd)`.
- `parseJalali(str)` / `parseGregorian(str)` — flexible separators (`/`, `-`, `.`).
- `formatJalali(date)` / `formatGregorian(date)`.
- `jalaliMonthGrid(jy, jm)` / `gregorianMonthGrid(y, m)` — week-aligned 6×7 day arrays.
- Helpers: `addDays`, `addMonths`, `startOfWeek`, `startOfMonth`, `sameDay`, `isoFromDate`, `dateFromIso`, `pad`.
- Month name arrays (`jMonths`, `gMonths`) and `dowShort`.

The order form's date input has its own `J`/`G` toggle independent of the calendar page setting; flipping it converts the typed value rather than wiping it.

---

## Styling

CSS variables in `:root` drive the dark theme:
```text
--bg / --bg-2 / --bg-3   page, card, deeper-card backgrounds
--text / --muted         primary + secondary text
--accent / --accent-2    primary action color
--good / --warn / --bad  green / amber / red
--personal --storefront --wholesale --tax   bucket swatches
```
Layout is responsive: sidebar collapses below 720px, 4-column / 2-column grids reflow at 1100px and 720px.

---

## State (`app.js`)

```text
state = {
  calMode,         // 'jalali' | 'gregorian'  (persisted in meta)
  calCursor,       // first-of-month for calendar navigation
  chartGran,       // 'week' | 'month'
  ordersView,     // 'cards' | 'list'
  formCalMode,    // calendar mode for the order form's date input
  editingOrderId,
  confirmCb,
  cache: { orders, customers, products }
}
```

`refreshCache()` re-pulls all three stores; `render()` clears the view and dispatches to the right `render<Page>` function. Datalists for customer / product autocomplete are rebuilt from the cache on every render.

---

## Backup / Import

- Export wraps everything as `{ appavet: true, schemaVersion: 3, exportedAt, orders, customers, products, expenses, funding, stockMoves, settings, tombstones }`.
- `migrate()` rejects exports made by a newer schema version than the running app supports.
- Import modes:
  - **Replace** — the file becomes the truth; records not in it are tombstoned so synced devices drop them too.
  - **Merge** — gives records fresh IDs and remaps `order.customerId`, line `productId`s and stock moves to them.
- After any successful import or export, `meta.lastBackup` is updated; the sidebar shows the timestamp.

---

## Conventions / patterns

- Money is formatted with thousands separators and a trailing `T` (Toman).
- Dates are stored as ISO `YYYY-MM-DD`; display follows `state.calMode`.
- Confirm dialogs route through a single shared modal + callback (`state.confirmCb`).
- Toasts auto-hide after 2.4s and have `error` / `ok` variants.
- All pages re-render via `render()` rather than partial updates after a mutation.
