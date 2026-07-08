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

## Shopify automatic sync (no CSVs)

Orders & imports has a **Sync Shopify now** button, and a Vercel cron syncs
automatically every night at 3am. One-time setup:

1. Shopify admin → **Settings → Apps and sales channels → Develop apps** →
   Allow custom app development → **Create an app** (e.g. "KantoForge HQ").
2. App → **Configuration → Admin API integration** → tick **read_orders**
   (and **read_all_orders** if listed, for history beyond 60 days) → Save.
3. **API credentials** → Install app → copy the **Admin API access token** (`shpat_…`, shown once).
4. Vercel → Settings → Environment Variables, add:
   - `SHOPIFY_STORE_DOMAIN` — e.g. `your-store.myshopify.com`
   - `SHOPIFY_ADMIN_TOKEN` — the `shpat_…` token
   - `SUPABASE_SERVICE_ROLE_KEY` — Supabase → Settings → API → `service_role` (server-side only, never exposed to browsers)
   - `CRON_SECRET` — any long random string (authenticates the nightly cron)
5. Redeploy, then press **Sync Shopify now**. The first run pulls full history;
   later runs only fetch changes. CSV import still works and remains the route for Etsy.

The endpoint (`api/sync-shopify.js`) only responds to signed-in team members or
the cron secret.

## How profit is calculated

```
revenue      = items + postage charged − discounts − refunds   (sales tax excluded)
fees         = platform fees from your Settings rates
               (Etsy card fees use the actual figure from the CSV when present)
cogs         = matched product costs + packaging + postage you pay
gross profit = revenue − fees − cogs
net profit   = gross profit − fixed monthly overheads
```

## Deploying (GitHub → Supabase → Vercel)

Data lives in **Supabase** (Postgres + auth) and the whole team shares it live —
dashboards update in realtime when a teammate imports orders or moves a task.

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com) (free tier is plenty).
2. In the project: **SQL Editor → New query**, paste the whole of
   [`supabase/schema.sql`](supabase/schema.sql), **Run**.
3. **Authentication → Sign In / Providers → Email**: for the smoothest start, turn **off**
   "Confirm email" (you can re-enable later).
4. **Settings → API**: copy the **Project URL** and the **anon public** key.

### 2. Vercel

1. [vercel.com](https://vercel.com) → **Add New → Project** → import this GitHub repo.
2. Framework preset: **Create React App** (auto-detected). No build settings to change.
3. Under **Environment Variables** add:
   - `REACT_APP_SUPABASE_URL` = your Project URL
   - `REACT_APP_SUPABASE_ANON_KEY` = your anon public key
4. **Deploy.** Every push to the production branch redeploys automatically.

### 3. First run

1. Open the deployed URL → **Create account**. The first account becomes the **admin**.
2. Colleagues use the same URL → Create account → they appear on the Team page as members.
3. Once the team is in, consider turning **off** "Allow new users to sign up" in Supabase
   (Authentication → Sign In / Providers) so strangers can't join your workspace.

Local development: copy `.env.example` to `.env.local`, fill in the two values, `yarn start`.

### Security model

- The anon key is public by design; **Row Level Security** does the protecting: only
  signed-in users can touch data, and only admins can change other people's roles.
- Anyone who signs up becomes a member with full business-data access — that's why you
  disable public signups after onboarding, or invite via the Supabase dashboard
  (Authentication → Users → Invite).

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
