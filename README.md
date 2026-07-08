# KantoForge HQ

The internal admin platform for [KantoForge](https://kantoforge.com) — one place for you and the
team to log in, import sales from Shopify and Etsy, track true costs, see real profit, and manage
tasks together.

## What's inside

| Tool | What it does |
|---|---|
| **Dashboard** | Revenue, fees, gross profit and net-after-overheads at a glance, monthly revenue vs profit chart, platform split donut, Shopify vs Etsy scorecard. |
| **Analytics** | Full P&L for any date range, monthly revenue/profit by platform, fee breakdown (where every penny of fees goes), top products by profit, sortable product table. |
| **Orders & imports** | Drag-and-drop CSV import for Shopify order exports and Etsy sold-orders / sold-order-items files. Re-importing is safe — orders merge by ID, never duplicate. Searchable order list with per-order profit. |
| **Costs** | Product cost rules (match by SKU or name), per-order packaging and postage defaults, fixed monthly overheads. Flags imported products that don't have a cost rule yet. |
| **Pricing calculator** | What-if tool: enter a price and your costs, see the exact fee breakdown and take-home on either platform — plus the price you'd need to hit a target margin. |
| **Tasks** | Shared kanban board (to do / in progress / done) with assignees, priorities and due dates. |
| **Team** | Invite colleagues with their own logins, admin/member roles, password resets. |
| **Settings** | Every fee rate is editable (Etsy transaction/payment/listing/regulatory/offsite-ads, Shopify payment rates), currency, and data export/restore. |

## Getting started

```bash
yarn install
yarn start        # dev server on http://localhost:3000
yarn build        # production build in ./build
```

The repo ships with `netlify.toml`, so pushing to a Netlify-connected repo deploys it as-is.

First visit shows a **Create owner account** screen — that's you (admin). Then:

1. **Costs** → add product cost rules and your fixed monthly overheads.
2. **Settings** → check the fee rates match your latest Etsy/Shopify statements (UK defaults included).
3. **Orders & imports** → upload:
   - Shopify: *Admin → Orders → Export → Export orders (plain CSV)*
   - Etsy: *Shop Manager → Settings → Options → Download Data* — download **both** the
     `Orders` and `Order Items` CSVs and import both (the items file adds per-product detail;
     the orders file adds actual card-processing fees).
4. **Team** → add your colleagues.

## How profit is calculated

```
revenue      = items + postage charged − discounts − refunds   (sales tax excluded)
fees         = platform fees from your Settings rates
               (Etsy card fees use the actual figure from the CSV when present)
cogs         = matched product costs + packaging + postage you pay
gross profit = revenue − fees − cogs
net profit   = gross profit − fixed monthly overheads
```

## Where the data lives (important)

All data — accounts, orders, costs, tasks — is stored **in the browser** (localStorage).
That means:

- It works with zero hosting cost and nothing to maintain, but data is **per device**.
- **Settings → Data → Export backup** regularly. The backup file restores everything, and it's
  also how you share data with a teammate on another machine today.

### Upgrade path to real multi-user sync

When you're ready for the team to share live data across devices, the app's data layer is isolated
in `src/lib/store.js` — swap localStorage for a hosted database and everything else works
unchanged. The natural options from lightest to heaviest:

1. **Supabase** (recommended): free tier covers this easily — Postgres + built-in auth replaces
   `src/lib/auth.js` too.
2. **Netlify Identity + Netlify Blobs/Functions** if you want to stay all-Netlify.
3. A small custom API.

## Code map

```
src/
  App.js                    shell, sidebar navigation, auth gate
  lib/
    store.js                persistence, defaults, backup import/export
    auth.js                 password hashing + login checks
    csv.js                  CSV parser, Shopify/Etsy format detection, order merging
    fees.js                 fee engine + product-cost matching
    calc.js                 profit maths, monthly series, product/fee breakdowns
    format.js               money/date formatting
  components/
    charts.js               hand-rolled SVG charts (bars, donut, h-bars) with tooltips
    Dashboard.js  AnalyticsPage.js  OrdersPage.js  CostsPage.js
    PricingPage.js  TasksPage.js  TeamPage.js  SettingsPage.js  Login.js
```
