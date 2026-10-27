# Excledge Design System — Principal UI/UX Architecture

> A human-centric, zero-training ERP design system for multi-branch retail & warehouse environments.

---

## Table of Contents

1. [Design Tokens & Usability Guardrails](#1-design-tokens--usability-guardrails)
2. [Layout Architecture](#2-layout-architecture)
3. [Multi-Branch Navigation & Context Switching](#3-multi-branch-navigation--context-switching)
4. [Core Workflow Architectures](#4-core-workflow-architectures)
5. [Component-by-Component Wireframe Blueprints](#5-component-by-component-wireframe-blueprints)
6. [State & Interaction Specifications](#6-state--interaction-specifications)
7. [Accessibility & Usability Best Practices](#7-accessibility--usability-best-practices)

---

## 1. Design Tokens & Usability Guardrails

### 1.1 Color Palette — Semantic by Domain

All colors are defined in `tailwind.config.js` under `theme.extend.colors`. Tokens map directly to Tailwind utility classes.

```js
// tailwind.config.js — color extension
colors: {
  // ── Brand / Chrome ──────────────────────────────────
  chrome: {
    950: '#0a1628',   // deep navy — sidebar/chrome base
    900: '#0f2744',   // chrome gradient start
    800: '#1a365d',   // chrome hover states
    700: '#2a4a7f',   // chrome active states
  },

  // ── Semantic: Inventory Health ──────────────────────
  stock: {
    safe: {
      DEFAULT: '#059669',   // emerald-600
      light:  '#d1fae5',    // emerald-100
      dark:   '#065f46',    // emerald-800
    },
    low: {
      DEFAULT: '#d97706',   // amber-600
      light:  '#fef3c7',    // amber-100
      dark:   '#92400e',    // amber-800
    },
    out: {
      DEFAULT: '#dc2626',   // red-600
      light:  '#fee2e2',    // red-100
      dark:   '#991b1b',    // red-800
    },
  },

  // ── Semantic: Expiry ────────────────────────────────
  expiry: {
    fresh:   '#059669',
    warning: '#d97706',
    expired: '#dc2626',
  },

  // ── Branch / Multi-tenant ──────────────────────────
  branch: {
    primary:   '#2563eb',    // blue-600
    secondary: '#7c3aed',    // violet-600 — "All Branches" marker
    inactive:  '#94a3b8',    // slate-400
    suspended: '#dc2626',    // red-600
  },

  // ── Surface / Background ───────────────────────────
  surface: {
    DEFAULT: '#ffffff',
    muted:   '#f8fafc',
    dark:    '#0c0a09',
    'dark-muted': '#1c1917',
  },
}
```

**Application rules:**
- `stock.safe` — batch at or above reorder threshold, quantity > 20% of max
- `stock.low` — quantity between > 0 and ≤ reorder threshold
- `stock.out` — quantity = 0
- Never use color alone; always pair with a recognizable icon (Package, AlertTriangle, XCircle) and text label

### 1.2 Typography Scale

| Token | Size | Weight | Line Height | Usage |
|-------|------|--------|-------------|-------|
| `display` | 2.25rem (36px) | 700 | 1.15 | Dashboard KPI figures, total sales, stock count |
| `heading-1` | 1.5rem (24px) | 600 | 1.25 | Page titles, dialog titles |
| `heading-2` | 1.125rem (18px) | 600 | 1.3 | Section headers, card titles |
| `heading-3` | 0.9375rem (15px) | 600 | 1.35 | Sub-section headers, table column groups |
| `body` | 0.875rem (14px) | 400 | 1.5 | Default body text, form labels, table cells |
| `body-sm` | 0.8125rem (13px) | 400 | 1.4 | Secondary info, metadata |
| `caption` | 0.75rem (12px) | 500 | 1.3 | Badges, timestamps, tab labels, helper text |
| `overline` | 0.6875rem (11px) | 600 | 1.2 | Section labels, chart annotations |

**Implementation in Tailwind:**

```js
fontSize: {
  'display': ['2.25rem', { lineHeight: '1.15', fontWeight: '700' }],
  'h1':      ['1.5rem',  { lineHeight: '1.25', fontWeight: '600' }],
  'h2':      ['1.125rem',{ lineHeight: '1.3',  fontWeight: '600' }],
  'h3':      ['0.9375rem',{lineHeight: '1.35', fontWeight: '600' }],
  'body':    ['0.875rem', { lineHeight: '1.5',  fontWeight: '400' }],
  'body-sm': ['0.8125rem',{ lineHeight: '1.4',  fontWeight: '400' }],
  'caption': ['0.75rem',  { lineHeight: '1.3',  fontWeight: '500' }],
  'overline':['0.6875rem',{ lineHeight: '1.2',  fontWeight: '600' }],
}
```

### 1.3 Spacing & Rhythm

| Token | Value | Usage |
|-------|-------|-------|
| `gap-xs` | 4px | Inline icon+text spacing |
| `gap-sm` | 8px | Between badge groups, button groups |
| `gap-md` | 12px | Between form fields in a row |
| `gap-lg` | 16px | Between cards, between sections |
| `gap-xl` | 24px | Between major page sections |
| `gap-2xl` | 32px | Page to edge, between panels |
| `inset` | 16px | Card body padding |
| `inset-sm` | 12px | Compact card / table cell padding |
| `inset-lg` | 24px | Dialog body padding |

### 1.4 Elevation & Shadow

| Token | Value | Usage |
|-------|-------|-------|
| `shadow-card` | `0 1px 3px 0 rgb(0 0 0 / 0.04), 0 1px 2px -1px rgb(0 0 0 / 0.06)` | Default card |
| `shadow-dropdown` | `0 4px 16px -2px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.04)` | Menus, popovers |
| `shadow-modal` | `0 20px 60px -12px rgb(0 0 0 / 0.25)` | Dialog overlay |
| `shadow-sticky` | `0 -1px 3px 0 rgb(0 0 0 / 0.04)` | Sticky footer bar |

### 1.5 Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `radius-sm` | 4px | Input fields, small badges |
| `radius-md` | 6px | Cards, dialogs, buttons |
| `radius-lg` | 8px | Large cards, modals |
| `radius-full` | 9999px | Pills, avatars, status dots |

### 1.6 Touch Target Requirements

| Target Type | Min Size | Notes |
|-------------|----------|-------|
| Primary actions (POS buttons, add-to-cart) | 48×48px | Thumb zone, both hands |
| Secondary actions (icon buttons) | 44×44px | Minimum for touch |
| Form inputs | 44px tall | Single-line inputs |
| Selectable rows | 44px tall | Table rows, list items |
| Branch selector trigger | 40px tall | Stays in header chrome |

---

## 2. Layout Architecture

### 2.1 App Shell Hierarchy

```
┌────────────────────────────────────────────────────┐
│  GLOBAL CHROME  (dashboard-chrome gradient)         │
│  ┌──────────┬──────────────────────────────────┐   │
│  │          │  Header Bar                       │   │
│  │  SIDE    │  [Menu] [BranchSelector] [User]   │   │
│  │  BAR     ├──────────────────────────────────┤   │
│  │           │                                  │   │
│  │  Nav     │  DASHBOARD MAIN                   │   │
│  │  Items   │  (Outlet)                         │   │
│  │           │  ┌──────┐ ┌──────┐ ┌──────┐     │   │
│  │  collaps │  │ KPI  │ │ KPI  │ │ KPI  │     │   │
│  │  ible    │  └──────┘ └──────┘ └──────┘     │   │
│  │  64→256px│  ┌────────────────────────┐      │   │
│  │           │  │  Content Area          │      │   │
│  │           │  │                        │      │   │
│  └──────────┴──────────────────────────────────┘   │
└────────────────────────────────────────────────────┘
```

**Key rules:**
- Sidebar collapses: expanded = 256px, collapsed = 64px (icons only)
- Header is 56px tall, sticky at top
- Main content area: `flex-1 overflow-y-auto`, scrolls independently
- Branch indicator sits in the header — always visible, never scrolls away
- Mobile: sidebar becomes a full-screen overlay (drawer), header remains at 56px

### 2.2 Responsive Breakpoints

| Breakpoint | Width | Layout Behavior |
|------------|-------|-----------------|
| `mobile` | < 640px | Single column, stacked cards, bottom nav replaces sidebar |
| `tablet` | 640–1023px | 2-column grids, sidebar collapsed by default, persistent header |
| `desktop` | 1024–1279px | Sidebar expanded, 3-column KPI grids |
| `wide` | ≥ 1280px | Full sidebar, multi-column layouts, side panels |

### 2.3 Page-Level Layout Patterns

There are three page layout templates, each a reusable wrapper:

**A. Dashboard / Analytics Page:**
```
[PageHeader]     → title + branch indicator + action button
[KpiRow]         → 3-4 stat cards in a responsive grid
[ContentGrid]    → 2-column layout: main chart + secondary list
[BranchesBreakdown] → segmented bar/table (visible only in "All Branches" mode)
```

**B. List / Data Grid Page:**
```
[PageHeader]     → title + primary action (e.g., "Add Product")
[SearchBar]      → global search input + filter badges row
[FilterChips]    → horizontally scrollable chip row
[DataGrid]       → responsive table / card grid
[PaginationBar]  → page controls + item count
```

**C. Form / Wizard Page:**
```
[PageHeader]     → step indicator (wizard steps) + title
[FormCard]       → white card container, 640px max-w centered
[FormSection]    → progressive disclosure sections within the card
[StickyFooter]   → Save / Back / Next actions pinned to bottom
```

---

## 3. Multi-Branch Navigation & Context Switching

### 3.1 The Branch Selector — Global, Persistent, Unambiguous

**Component: `BranchSelector`**

**Visual structure:**
```
┌─────────────────────────────────────────────┐
│  [Branch icon]  Kigali Central  ▾  [primary]│  ← header trigger
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│  🔍 Search branches...                      │  ← always-filterable
├─────────────────────────────────────────────┤
│  SELECT BRANCH                              │
│                                             │
│  ○ All Branches                  [ALL]      │  ← only for admins/owners
│    View data from all branches              │
│                                             │
│  ○ ● Kigali Central Branch      [PRIMARY]   │  ← primary pill
│    Code: KGL-001                            │
│                                             │
│  ○  Huye Branch                             │
│    Code: HUY-002                            │
│                                             │
│  ○  Rubavu Warehouse                        │
│    Code: RUB-003                            │
└─────────────────────────────────────────────┘
```

**Interaction model:**
- Trigger button shows: `[Layers icon] Branch Name`
- When `null` (All Branches): label reads `"All Branches (N)"` with a purple `ALL` badge
- When a single branch: label shows branch name with blue `PRIMARY` badge (if applicable)
- Dropdown is searchable — type to filter by name or code
- Selection is persisted to `localStorage('selected_branch_id')` and restored on reload
- Changing branch triggers a route-agnostic refetch via React Query invalidation

**Context indicator badge:**
Every page title is suffixed with a `BranchBadge`:

```
KPI Card Header:  "Current Stock"  └───── Kigali Central ────┘
                                         (blue dot + name)
```

### 3.2 The "All Branches" View — Aggregated, Segmented, Scannable

When `selectedBranchId === null`:

**A. KPI Cards** show aggregate totals with a stacked micro-bar per branch:

```
┌──────────────────────────────────────────────┐
│  Total Inventory Value                        │
│  R 12,450,000                    ↑ +8.2%     │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━    │
│  ████████████░░░░░░░░░░░░  Kigali  52%       │  ← each branch as a
│  ██████████░░░░░░░░░░░░░  Huye    28%        │     colored segment
│  ██████░░░░░░░░░░░░░░░░░  Rubavu   20%       │     in a stacked bar
└──────────────────────────────────────────────┘
```

**B. Data tables** gain a `Branch` column as the first frozen column. Every row includes the branch name + a small colored dot (status).

**C. Charts** use a multi-series color mapping: each branch gets a consistent hue (assigned from a categorical 12-color palette). A legend sits below the chart.

**D. Branch-level empty states** — if a branch has no data, the KPI micro-bar still shows it as a 0% segment with a dashed outline.

### 3.3 Branch-Restricted Users — Graceful Locking

A restricted user (non-admin, assigned to 1+ specific branches) sees:

**1. Branch selector is disabled** — no dropdown, just a static label with a lock icon and the branch name.

```
┌───────────────────────────────┐
│  🔒  Kigali Central  [PRIMARY]│  ← no dropdown arrow
└───────────────────────────────┘
```

**2. Locked modules** — navigation items for unauthorized sections (e.g., "Organization Settings", "User Management") are:
- Rendered but visually muted (`opacity-40`, no pointer events)
- Tooltip on hover: *"Contact your administrator to access this section"*

**3. Locked fields within accessible modules** — form inputs or table columns that are branch-immutable (e.g., editing another branch's pricing) show:
- A disabled state with a lock icon at the right edge
- Tooltip: *"This field is managed by [Branch Name]"*

**4. The visual contract is never broken** — no broken layouts, no missing sections, no 404-style gaps. Everything is intentionally dimmed with explanatory tooltips.

---

## 4. Core Workflow Architectures

### 4.1 Product Ingestion & Inventory Adjustments

#### 4.1a Single Product Form — Progressive Disclosure

**Structure:** A single-page wizard with collapsible sections stacked vertically.

```
┌──────────────────────────────────────────────┐
│  Add New Product                      Step 2 │  ← Step counter (1/4)
│                                             │
│  ● Basic Information        ─  ─  ─  ─  ─  │  ← active step
│  │                                         │
│  │  Name              [_________________] │
│  │  Description       [_________________] │
│  │  Category          [Select ▼]          │
│  │  Brand             [Select ▼]          │
│  └─────────────────────────────────────────│
│                                             │
│  ○ Pricing & Tax       ─  ─  ─  ─  ─  ─  │  ← collapsed, click
│  (Click to expand)                          │     to reveal
│                                             │
│  ○ Batch & Barcodes    ─  ─  ─  ─  ─  ─  │
│  (Click to expand)                          │
│                                             │
│  ○ Initial Stock        ─  ─  ─  ─  ─  ─  │
│  (Click to expand)                          │
│                                             │
├──────────────────────────────────────────────┤
│  [← Back]  [Save as Draft]  [Save Product]  │ ← sticky footer
└──────────────────────────────────────────────┘
```

**Behavior:**
- Each section is a `<Card>` with a chevron toggle header
- Only one section open at a time (accordion pattern)
- Section headers show validation status: green checkmark (complete), amber dot (incomplete), red exclamation (errors)
- Long forms never exceed viewport height — the sticky footer is always reachable

#### 4.1b Bulk Imports — Error Isolation

**Interaction flow:**

1. **Upload zone** — large dashed drop target (min 200px tall) with "Drag CSV here or click to browse"
2. **Column mapping** — after upload, auto-detect headers and show a mapping matrix:

```
┌──────────────────────────────────────────────┐
│  Column Mapping                              │
│                                             │
│  CSV Header    →  System Field     Status   │
│  ────────────     ─────────────    ──────   │
│  Product Name  →  name            ✓ auto    │
│  SKU           →  sku             ✓ auto    │
│  Price         →  sellPrice       ✓ auto    │
│  Branch        →  [branchId ▼]   ⚠ mapped  │  ← manual assign
│  Expiry Date   →  ─────────      ✗ unmapped │  ← red, needs action
└──────────────────────────────────────────────┘
```

3. **Validation pass** — all rows are validated in-batch. Results return inline:

```
┌──────────────────────────────────────────────┐
│  Rows: 495 ✓ valid  ·  5 ⚠ errors           │
│                                             │
│  ═══ Row #203  ═══════════════════════════   │
│  ⚠ Batch "BAT-2024-09" already exists       │
│  ☐ Skip this row    ☐ Auto-rename to ...    │  ← inline resolution
│                                             │
│  ═══ Row #297  ═══════════════════════════   │
│  ⚠ Invalid price format: "1,500.00"         │
│    ┌──────────┐   Corrected value: 1500.00  │
│    │ [Accept] │                              │
│    │ [Edit…]  │                              │
│    └──────────┘                              │
│                                             │
│  ═══ Row #401  ═══════════════════════════   │
│  ⚠ Missing required field: "category"       │
│  ┌──────────────────────┐                    │
│  │ [Select Category ▼]  │                    │
│  └──────────────────────┘                    │
└──────────────────────────────────────────────┘
```

4. **Error grouping** — identical errors (e.g., "Missing category") are grouped with a count: `⚠ Missing category (3 rows)` to avoid repeating the same fix.

5. **Commit** — on submit, valid rows are ingested, skipped rows are logged, and a results summary is shown: *"492 products imported · 3 rows skipped · 5 errors fixed"*

#### 4.1c Stock Adjustments — Confirmation-Locked

**Dialog: `StockAdjustmentDialog`**

```
┌──────────────────────────────────────────────┐
│  Adjust Stock                         X      │
│                                             │
│  Product:  Paracetamol 500mg (PCM-001)      │
│  Branch:   ● Kigali Central Branch          │  ← locked, always visible
│  Batch:    BAT-2024-09 (Exp: 2026-12-31)   │
│                                             │
│             Current: 1,240 units             │
│                                             │
│  ┌──────────────────┬──────────┬──────────┐ │
│  │  [−]    100      [+]  │  Reason:     │ │
│  └──────────────────┴──────────┴──────────┘ │
│                                  ▼           │
│                          ┌────────────┐     │
│                          │ Damaged    │     │
│                          │ Audit      │     │
│                          │ Expired    │     │
│                          │ Other…     │     │
│                          └────────────┘     │
│                                             │
│  New quantity after adjustment:  1,140      │
│                                             │
│  Reason: Damaged Stock                      │
│  Note:   [Optional note…________________]  │
│                                             │
├──────────────────────────────────────────────┤
│        [Cancel]  [Confirm Adjustment]       │
└──────────────────────────────────────────────┘
```

**Key interaction:**
- ± buttons adjust by predefined steps (1, 10, 100 via shift-click)
- Manual input is always allowed alongside ±
- Branch is displayed prominently and cannot be changed within the dialog
- Reason is **required** — dropdown with common presets + free text
- Confirmation button is disabled until a reason is selected
- On confirm, a brief toast confirms: *"Adjusted −100 units · Reason: Damaged Stock"*

### 4.2 High-Fidelity Data Grids

#### 4.2a Universal Search + Badge Filters

**Layout:**

```
┌──────────────────────────────────────────────┐
│  🔍  Search products, SKUs, or batches…     │
│     [________________________________]      │
│                                             │
│  Filters:                                    │
│  [Status: Low Stock ×] [Cat: Meds ×]        │  ← removable chips
│  [Branch: Kigali ×] [Expiry <30d ×]         │
│  [+ Add Filter ▼]                            │
└──────────────────────────────────────────────┘
```

**Search behavior:**
- Debounced 300ms — results update as you type
- Searches across `name`, `sku`, `batch.code`, `batch.batchNumber`, `category.name`
- Results highlight the matched substring in bold
- Empty state: *"No results for 'xyz'. Try searching by SKU or batch number."*

**Filter chips:**
- Click a chip to remove that filter
- "+ Add Filter" opens a popover with filter categories (Status, Category, Branch, Expiry, Price Range)
- Each filter type has appropriate UI: checkboxes for categories, range slider for price, date picker for expiry
- Applied filters update the URL query params for shareable/bookmarkable state

#### 4.2b Data Grid — Dense, Scan-optimized

```
┌──────────────────────────────────────────────────────────────┐
│  □  Product Name     SKU        Stock  Batch      Expiry   │  ← sticky header
├──────────────────────────────────────────────────────────────┤
│  ☐  Paracetamol 500  PCM-001    1,240  BAT-2024  2026-12  │  ← safe (green)
│     Tablets                            [●●●●●]             │  ← stock bar
│  ☐  Amoxicillin 250  AMX-002      120  BAT-2024  2025-03  │  ← low (amber)
│     Capsules                            [●○○○○]             │
│  ☐  Ibuprofen 400mg  IBU-003        0   —         2024-01  │  ← out (red)
│     Tablets                                                 │
│  ☐  …                                                       │
├──────────────────────────────────────────────────────────────┤
│  Showing 1–25 of 1,024                    < 1 2 3 … 41 >   │
└──────────────────────────────────────────────────────────────┘
```

**Row design rules:**
- Row height: 44px minimum (touch-friendly)
- Product name in `body` weight, secondary description in `body-sm` muted
- Stock column: number rendered in `body` weight with a 4-dot stock bar (each dot = 25% of max)
  - 4 dots filled = 100–76% (safe green)
  - 3 dots filled = 75–51% (safe green)
  - 2 dots filled = 50–26% (low amber)
  - 1 dot filled = 25–1% (low amber)
  - 0 dots = 0% (out red, with ⛔ icon)
- Batch column: shows batch code + expiry month/year
- Expiry column: color-coded text (fresh green, warning amber, expired red)
- Checkbox column on left for bulk selection
- First column is always the row anchor (click navigates to detail)
- `sticky` header with `bg-white/95 backdrop-blur-sm` backdrop blur

### 4.3 Point of Sale (POS) & Sales Lifecycles

#### 4.3a Batch Selection — Smart FIFO with 1-Click Override

**Context:** When a product has multiple batches (critical for pharmaceuticals with expiration dates), the POS shows a batch selector.

```
      Cart Item: Paracetamol 500mg (PCM-001)
      ┌─────────────────────────────────────────────┐
      │  Recommended Batch (FIFO)                    │
      │  ┌─────────────────────────────────────────┐ │
      │  │ ● BAT-2024-09  ·  Exp: 2026-12-31      │ │  ← green checkmark
      │  │   Available: 5,200 units     → Qty: 10 │ │
      │  │   Cost: R 500/unit   Margin: 35%       │ │
      │  └─────────────────────────────────────────┘ │
      │                                              │
      │  Other Batches:          [Show All ▼]       │  ← expandable
      │  ┌─────────────────────────────────────────┐ │
      │  │ ○ BAT-2023-04  ·  Exp: 2025-08-15  [⚠] │ │  ← near-expiry
      │  │   Available: 200 units                   │ │
      │  └─────────────────────────────────────────┘ │
      │  ┌─────────────────────────────────────────┐ │
      │  │ ○ BAT-2022-11  ·  Exp: 2024-06-30  [✗] │ │  ← expired
      │  │   Available: 0 units                     │ │
      │  └─────────────────────────────────────────┘ │
      └─────────────────────────────────────────────┘
```

**Logic:**
- By default, the system auto-selects the oldest expiring batch with available stock (FIFO — First Expired, First Out)
- A green checkmark + "Recommended" label makes the selection obvious
- The cashier can 1-click any other batch to override
- Near-expiry batches (< 90 days) show an amber warning icon
- Expired batches show a red icon and are grayed out (not selectable)
- Quantity input is at the batch level: "Use 10 units from this batch"

#### 4.3b Returns & Cancellations — Walk-Through Ledger Update

**Dialog flow (3-step within a single dialog):**

```
Step 1: Select Sale
┌──────────────────────────────────────────────┐
│  Process Return                       Step 1 │
│                                             │
│  🔍 Search by receipt # or customer…        │
│  ┌──────────────────────────────────────┐   │
│  │  Receipt: INV-2024-0912              │   │
│  │  Date: 2024-09-15  |  Customer: XYZ │   │
│  └──────────────────────────────────────┘   │
│                                             │
│  Items from this sale:                      │
│  ┌──────────────────────────────────────┐   │
│  │ ☐ Paracetamol 500mg  × 20  R 10,000 │   │
│  │ ☐ Amoxicillin 250mg  × 10  R 8,000  │   │
│  │ ☐ Ibuprofen 400mg     × 5   R 3,500 │   │
│  │ ☐ ...                               │   │
│  └──────────────────────────────────────┘   │
│                                             │
├──────────────────────────────────────────────┤
│              [Cancel]  [Next: Return Items]  │
└──────────────────────────────────────────────┘

Step 2: Return Quantities
┌──────────────────────────────────────────────┐
│  Process Return                       Step 2 │
│                                             │
│  Paracetamol 500mg     Return: [ 5 ] of 20  │
│    → Will restore to batch: BAT-2024-09     │  ← smart batch match
│    → Restocking condition:                   │
│      ○ Sellable (re-shelve)                  │  ← default
│      ○ Damaged (disposal)                    │
│      ○ Expired (disposal)                    │
│                                             │
│  Amoxicillin 250mg    Return: [ 2 ] of 10   │
│    → Will restore to batch: BAT-2024-06     │
│    → Restocking condition: [Sellable ▼]     │
│                                             │
├──────────────────────────────────────────────┤
│        [← Back]  [Next: Confirm Return]     │
└──────────────────────────────────────────────┘

Step 3: Confirmation Summary
┌──────────────────────────────────────────────┐
│  Process Return                      Confirm │
│                                             │
│  Summary:                                    │
│  ┌──────────────────────────────────────┐   │
│  │  Items returned:  2                  │   │
│  │  Total refund:    R 3,500            │   │
│  │  Restocking:      Sellable — 2 items │   │
│  │                    Disposal — 0      │   │
│  │  Return reason:   Customer defect    │   │
│  │  Updated batches:                    │   │
│  │    BAT-2024-09: +5 → 1,245 units    │   │
│  │    BAT-2024-06: +2 → 830 units      │   │
│  └──────────────────────────────────────┘   │
│                                             │
│  Return Reason: [Customer defect ▼]         │  ← required
│                                               │
├──────────────────────────────────────────────┤
│        [← Back]  [✓ Confirm Return]          │
└──────────────────────────────────────────────┘
```

**Key behaviors:**
- The system auto-matches returned items to the original batch (tracked via sale line → batch linkage)
- Condition dropdown: "Sellable" restores to inventory, "Damaged" / "Expired" triggers disposal ledger entry
- Confirmation step shows exact ledger impact before commit
- On confirm: toast + option to print return receipt

---

## 5. Component-by-Component Wireframe Blueprints

### 5.1 Dashboard Page

```
┌──────────────────────────────────────────────────────────────┐
│  Dashboard                               Kigali Central ▾  │  ← PageHeader
├──────────────────────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │  ← KpiRow
│  │ Revenue  │ │ Orders   │ │ Low Stock│ │ Returns  │      │
│  │ R 2,400,000   │ │   1,240  │ │   12     │ │   8      │      │
│  │ ↑12%     │ │ ↑3%      │ │ ⚠ urgent │ │ ↓2%      │      │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
│                                                             │
│  ┌──────────────────────┐ ┌──────────────────────┐         │  ← ContentGrid
│  │ Sales (7 days)       │ │ Low Stock Alerts     │         │
│  │ [line chart]         │ │ ● Paracet — 120 left │         │
│  │                      │ │ ● Amoxi —  45 left   │         │
│  │                      │ │ ● Ibu —    0 left    │         │
│  └──────────────────────┘ └──────────────────────┘         │
│                                                             │
│  ┌──────────────────────────────────────────┐              │
│  │ Branch Breakdown (All Branches mode)     │              │
│  │ ┌────────┬────────┬────────┬────────┐   │              │
│  │ │ Branch │ Sales  │ Stock  │ Orders │   │              │
│  │ │ Kigali │ R 1,200,000 │ 12,400 │  540   │   │              │
│  │ │ Huye   │ R 800,000 │  8,200 │  320   │   │              │
│  │ │ Rubavu │ R 400,000 │  3,100 │  180   │   │              │
│  │ └────────┴────────┴────────┴────────┘   │              │
│  └──────────────────────────────────────────┘              │
└──────────────────────────────────────────────────────────────┘
```

**Skeleton loading state:**
- 4 KPI cards: gray shimmer rectangles, each 240×100px
- Chart area: large gray shimmer rectangle with wave animation
- Table: 5 rows of shimmer bars at varying widths
- No text, no layout shift — uses `skeleton.tsx` component with `animate-pulse`

### 5.2 Product Add Page

```
┌──────────────────────────────────────────────────────────────┐
│  Add Product                        Step 2 of 4  ●●○●      │  ← step indicator
├──────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────────────────────────────────┐   │
│  │ ▼ Basic Information                        ● Complete │   │
│  │  ┌────────────────┐  ┌────────────────┐              │   │
│  │  │ Name           │  │ SKU            │              │   │
│  │  │ [_____________]│  │ [_____________]│              │   │
│  │  └────────────────┘  └────────────────┘              │   │
│  │  ┌────────────────┐  ┌────────────────┐              │   │
│  │  │ Category       │  │ Brand          │              │   │
│  │  │ [Select ▼]     │  │ [Select ▼]     │              │   │
│  │  └────────────────┘  └────────────────┘              │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ ▼ Pricing & Tax                         ◌ Incomplete │   │ ← active section
│  │  ┌────────────────┐  ┌────────────────┐              │   │
│  │  │ Cost Price     │  │ Selling Price  │              │   │
│  │  │ [_____________]│  │ [_____________]│              │   │
│  │  └────────────────┘  └────────────────┘              │   │
│  │  ┌────────────────┐  ┌────────────────┐              │   │
│  │  │ Tax Code       │  │ Markup %       │              │   │
│  │  │ [Select ▼]     │  │ [_____________]│              │   │
│  │  └────────────────┘  └────────────────┘              │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ ▼ Batches & Barcodes                    ◌ Incomplete │   │ → collapsed
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ ▼ Initial Stock                          ◌ Incomplete │   │ → collapsed
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
├──────────────────────────────────────────────────────────────┤
│  [← Back]  [Save as Draft]  [✓ Save Product]              │  ← sticky footer
└──────────────────────────────────────────────────────────────┘
```

**Error state:**
- Field-level: red border on input, red text below: *"Selling price is required"*
- Section-level: red dot + error count on section header: *"2 errors in this section"*
- Toast on failed save: *"Please fix 3 errors before saving"*
- Non-blocking: user can navigate between sections without losing inputs

### 5.3 Product Grid Page

```
┌──────────────────────────────────────────────────────────────┐
│  Products  (1,024)                           [+ Add Product]│  ← PageHeader
├──────────────────────────────────────────────────────────────┤
│  🔍 Search by name, SKU, or batch…         [___________]   │  ← SearchBar
│                                                             │
│  Filters:  [Status: Low Stock ×] [Cat: Meds ×] [+ Add ▼]  │  ← FilterChips
├──────────────────────────────────────────────────────────────┤
│  ┌───┬──────────────┬───────┬──────┬────────┬────────┬────┐│
│  │ □ │ Product      │ SKU   │Stock │ Batch  │ Expiry │ … ││  ← DataGrid
│  ├───┼──────────────┼───────┼──────┼────────┼────────┼────┤│
│  │ □ │ Paracetamol  │PCM-001│ 1240 │BAT-09  │Dec'26  │    ││
│  │   │ 500mg Tabs   │       │ ████ │        │ ● safe │    ││
│  ├───┼──────────────┼───────┼──────┼────────┼────────┼────┤│
│  │ □ │ Amoxicillin  │AMX-002│  120 │BAT-06  │Mar'25  │    ││
│  │   │ 250mg Caps   │       │ ██░░ │        │ ● low  │    ││
│  ├───┼──────────────┼───────┼──────┼────────┼────────┼────┤│
│  │ □ │ Ibuprofen    │IBU-003│    0 │   —    │Jan'24  │    ││
│  │   │ 400mg Tabs   │       │ ░░░░ │        │ ● out  │    ││
│  ├───┼──────────────┼───────┼──────┼────────┼────────┼────┤│
│  │ … │              │       │      │        │        │    ││
│  └───┴──────────────┴───────┴──────┴────────┴────────┴────┘│
│  Showing 1–25 of 1,024                    ◀ 1 2 3 … 41 ▶  │  ← PaginationBar
└──────────────────────────────────────────────────────────────┘
```

**Empty state (no products):**
- Centered illustration (empty shelf icon via lucide `PackageX`)
- Title: *"No products yet"*
- Description: *"Add your first product to start tracking inventory"*
- CTA button: `[+ Add Product]`

**Empty search state:**
- Centered `SearchX` icon
- Title: *"No results for 'xyz'"*
- Description: *"Try searching by SKU or batch number, or clear your filters"*
- Action link: "Clear filters"

### 5.4 POS / Sales Registry

```
┌──────────────────────────────────────────────────────────────┐
│  Point of Sale                    Branch: Kigali Central ▾  │
├──────────────────────┬───────────────────────────────────────┤
│                      │                                       │
│  ┌────────────────┐  │  Cart (3 items)            R 24,500  │
│  │ 🔍 Search or   │  │  ┌──────────────────────────────┐   │
│  │   scan items…  │  │  │ Paracetamol × 10    R 5,000  │   │
│  │                │  │  │    Batch: BAT-2024-09  [Δ]  │   │
│  │ [_____________]│  │  ├──────────────────────────────┤   │
│  └────────────────┘  │  │ Amoxicillin  × 5    R 4,000  │   │
│                      │  │    Batch: BAT-2024-06  [Δ]  │   │
│  ┌────────────────┐  │  ├──────────────────────────────┤   │
│  │ Quick Categories│  │  │ Ibuprofen    × 2    R 1,400│   │
│  │ ┌──┬──┬──┬──┐  │  │ └──────────────────────────────┘   │
│  │ │All│Med│Vit│  │  │                                      │
│  │ ├──┼──┼──┼──┤  │  │  Discount: [____]%  -R 0.00        │
│  │ │   │   │   │  │  │  Subtotal:          R 10,400        │
│  │ └──┴──┴──┴──┘  │  │  Tax (18%):         R 1,872        │
│  └────────────────┘  │  ─────────────────────────────────   │
│                      │  Total:              R 12,272        │
│  ┌────────────────┐  │                                      │
│  │ Product Grid   │  │  ┌──────────────────────────┐       │
│  │ (scrollable)   │  │  │  Customer (optional)     │       │
│  │                │  │  │  [___________________]   │       │
│  │ ┌──┬──────────┐│  │  └──────────────────────────┘       │
│  │ │📦│Paracet   ││  │                                      │
│  │ │  │R 500     ││  │  ┌────────────┐  ┌────────────┐     │
│  │ ├──┼──────────┤│  │  │  Hold Cart │  │  Pay Now   │     │
│  │ │📦│Amoxi     ││  │  │            │  │  R 12,272  │     │
│  │ │  │R 800     ││  │  └────────────┘  └────────────┘     │
│  │ ├──┼──────────┤│  │        ↓                ↓            │
│  │ │📦│Ibu       ││  │    (disabled        (primary,       │
│  │ │  │R 700     ││  │     if empty)     always visible)   │
│  │ └──┴──────────┘│  │                                      │
│  └────────────────┘  │                                      │
│                      │                                      │
└──────────────────────┴───────────────────────────────────────┘
```

**Keyboard shortcuts (POS-specific):**
| Key | Action |
|-----|--------|
| `Ctrl+K` / `Cmd+K` | Focus item search |
| `Enter` | Add scanned item to cart |
| `+` / `-` | Increment / decrement quantity of selected line |
| `Delete` | Remove selected line from cart |
| `F2` | Open batch override for selected line |
| `F8` | Focus payment / checkout |
| `F10` | Focus customer search |
| `Escape` | Clear search / close modals |

**Payment modal:**
```
┌──────────────────────────────────────────────┐
│  Complete Payment                    R 12,272│
│                                             │
│  Method:                                    │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌──────┐ │
│  │  Cash  │ │  Card  │ │ Mobile │ │Credit│ │
│  └────────┘ └────────┘ └────────┘ └──────┘ │
│            ●                                │  ← selected state highlight
│  Amount:     [___________]  R 12,272        │
│  Change due:              R 0.00            │
│                                             │
│  Reference: [optional ref…________________] │
│                                             │
├──────────────────────────────────────────────┤
│        [Cancel]  [✓ Complete Sale]           │
└──────────────────────────────────────────────┘
```

---

## 6. State & Interaction Specifications

### 6.1 Loading Skeletons — Zero Layout Shift

Every page has a skeleton that mirrors the final layout exactly (same grid, same dimensions).

**Skeleton component pattern:**

```tsx
// /components/ui/PageSkeleton.tsx
// Accepts a `variant` prop: 'dashboard' | 'table' | 'form'
// Renders shimmer rectangles at exact dimensions of the final content
// Uses animate-pulse with bg-gray-200 (light) / bg-gray-700 (dark)
```

**Timing:**
- Show skeleton immediately on navigation (no delay)
- Minimum skeleton display: 300ms (prevents flash on fast loads)
- Transitions to content with a 150ms `fadeIn` opacity animation
- Error state replaces skeleton after timeout (default 15s)

### 6.2 Validation & Error Display

**Inline field validation:**
- Triggered on blur for text inputs, on change for selects
- Red border (`border-red-500`) + red text below (`text-caption text-red-500`)
- Error message is specific: *"Enter a valid price"*, not *"Invalid input"*

**Form-level validation:**
- On submit, scroll to first error field
- Focus that field
- Show a toast: *"Please fix 3 errors before saving"*

**API error handling:**
- Server validation errors map to field-level errors (400 response)
- Server errors (500): toast with *"Something went wrong. Please try again."*
- Network errors: toast with *"No internet connection. Your changes have been saved locally."* (uses `offlineQueue.ts`)

### 6.3 Destructive Action Confirmation

**Pattern: `AlertDialog` from shadcn/ui**

```
┌──────────────────────────────────────────────┐
│  ⚠ Delete Product                            │
│                                             │
│  Are you sure you want to delete             │
│  "Paracetamol 500mg"?                        │
│                                             │
│  This action cannot be undone. 1,240 units  │
│  will be removed from inventory.             │
│                                             │
│  Type "DELETE" to confirm:                   │
│  [_____________________________]             │
│                                             │
├──────────────────────────────────────────────┤
│     [Cancel]  [Delete Product]               │
│               (disabled until "DELETE")      │
└──────────────────────────────────────────────┘
```

**Rules:**
- Every delete action requires a confirmation dialog
- Destructive actions that affect data > 100 items require typing the confirmation word
- Non-destructive cancels (e.g., discard a draft): single-click confirmation
- "Delete" button is always `variant="destructive"` (red)

### 6.4 Toast Notification System

Using `react-toastify` (already in the project) with custom styling:

```
┌──────────────────────────────────────────┐
│  ✓  Product created successfully         │  ← success: green
│     "Paracetamol 500mg" added           │
└──────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│  ⚠  Low stock alert: Amoxicillin (45)   │  ← warning: amber
│     Reorder threshold: 100 units         │
└──────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│  ✗  Failed to save. 3 errors to fix.    │  ← error: red
│     Open form to review                  │
└──────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│  ℹ  Import complete: 492 of 500 rows    │  ← info: blue
│     View import log for 8 skipped        │
└──────────────────────────────────────────┘
```

**Position:** `bottom-center` on mobile (thumb reachable), `top-right` on desktop
**Auto-dismiss:** success=3s, warning=5s, error=manual dismiss, info=4s

### 6.5 Empty States — Never a Blank Page

Every data-driven view has 3 states:

| State | Visual | Message |
|-------|--------|---------|
| No data at all | Large icon + message + CTA | *"No products yet. Add your first product."* |
| No data for filter/search | Small icon + message + action link | *"No results match your filters. Clear filters"* |
| No access (restricted) | Lock icon + message | *"You don't have access to this data. Contact admin."* |

---

## 7. Accessibility & Usability Best Practices

### 7.1 Global Keyboard Shortcuts

| Shortcut | Action | Scope |
|----------|--------|-------|
| `?` | Show keyboard shortcuts help overlay | Global |
| `Ctrl+K` / `Cmd+K` | Focus global search | Global |
| `Alt+N` | Create new (record, product, sale — context-aware) | Global |
| `Escape` | Close dialog / sidebar / dropdown | Global |
| `Ctrl+S` / `Cmd+S` | Save current form | Forms only |
| `Tab` / `Shift+Tab` | Navigate between form fields | Forms only |
| `Space` | Toggle checkbox / expand accordion | Contextual |
| `↑` / `↓` | Navigate table rows / list items | Tables only |

### 7.2 Touch Interactions (Mobile / POS)

| Gesture | Action |
|---------|--------|
| Swipe left on table row | Reveal "Delete" action (with undo toast) |
| Swipe right on table row | Reveal "Edit" action |
| Long press (500ms) on row | Open context menu |
| Double-tap on KPI card | Drill into detail view |
| Pull-to-refresh | Reload current page data |
| Pinch-to-zoom on charts | Expand/collapse time range |

### 7.3 ARIA & Screen Reader Support

All Radix primitives provide built-in ARIA attributes. Custom additions:

- **Branch selector**: `role="combobox"` with `aria-expanded`, `aria-controls`, `aria-activedescendant`
- **Data grid**: `role="grid"` with `aria-rowcount`, `aria-colcount`, navigable via arrow keys
- **Stock badges**: `role="status"` with `aria-label="In stock: 1,240 units"`
- **Loading skeleton**: `aria-hidden="true"` (not announced to screen readers)
- **Dynamic updates**: Use `aria-live="polite"` for toast notifications, `aria-live="assertive"` for errors
- **Focus management**: On dialog open, focus first focusable element. On close, return focus to trigger element.
- **Skip to content**: Hidden skip link as first focusable element: *"Skip to main content"*
- **Color contrast**: All text meets WCAG 2.1 AA (4.5:1 normal text, 3:1 large text). Semantic colors never rely on hue alone.

### 7.4 Responsive Adjustments

| Element | Desktop (≥1024px) | Tablet (640–1023px) | Mobile (<640px) |
|---------|-------------------|---------------------|-----------------|
| Sidebar | Fixed 256px / 64px | Overlay drawer | Overlay drawer |
| Header | 56px with all controls | 56px with condensed controls | 56px with menu + branch only |
| KPI grid | 4 columns | 2 columns | 1 column (horizontal scroll) |
| Data table | Full table | Responsive: card layout per row | Card layout |
| Product form | 2-column fields | 2-column | 1-column stacked |
| POS layout | Side-by-side (search + cart) | Side-by-side | Cart full-screen, search as drawer |
| Bottom bar | — | — | Sticky bottom bar with primary actions |
| Dialog | Centered modal, max-w-lg | Full-width modal | Full-screen drawer |

### 7.5 Performance Budgets

| Metric | Target | Measurement |
|--------|--------|-------------|
| Time to interactive (dashboard) | < 2s | Lighthouse |
| First input delay | < 50ms | Web Vitals |
| List render (500 rows) | < 200ms | React DevTools profiler |
| Search response (debounced) | < 100ms after input | Manual |
| Skeleton → content swap | < 150ms fade | CSS transition |
| Bundle size (critical path) | < 150KB gzipped | Vite bundle analyzer |

---

## Appendix: Directory Structure for New Components

```
src/
  components/
    common/
      BranchBadge.tsx           # Inline branch context indicator
      StockBar.tsx              # 4-dot stock visualization
      EmptyState.tsx            # Reusable empty state (icon + text + CTA)
      FilterChips.tsx           # Badge-based filter row
      SearchInput.tsx           # Debounced global search input
      ConfirmDelete.tsx         # Typed-confirmation delete dialog
      StepIndicator.tsx         # Wizard step progress (● ● ○ ●)
      KpiCard.tsx               # Stat card with trend indicator
      BranchBreakdownBar.tsx    # Stacked branch bar for KPIs

    pos/
      BatchSelector.tsx         # Smart FIFO batch picker
      PaymentModal.tsx          # Multi-method payment dialog
      CartLine.tsx              # Single cart line item
      ProductGrid.tsx           # POS product grid (quick add)

    imports/
      ColumnMapping.tsx         # CSV column mapping matrix
      ErrorRowResolver.tsx      # Inline error fix per row
      ImportSummary.tsx         # Results summary after import

    data-grid/
      DataGrid.tsx              # High-fidelity data table
      DataGridHeader.tsx        # Sticky sortable header
      DataGridRow.tsx           # Row with stock bar, status icons
      PaginationBar.tsx         # Page controls

    forms/
      FormSection.tsx           # Collapsible form section (accordion)
      FormStickyFooter.tsx      # Sticky footer with Save/Back/Next
