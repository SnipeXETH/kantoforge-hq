-- OddBrew inventory: one row per variant (id = the portal's variant key, e.g.
-- 'sku:abc123' or 'name:oddbrewcup350ml'). Holds the manual counts you keep
-- (on hand, incoming, reorder point) plus the last-synced Shopify stock level.
-- Run once in Supabase → SQL Editor. Safe to re-run.

create table if not exists public.oddbrew_inventory (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.oddbrew_inventory enable row level security;

drop policy if exists "team full access" on public.oddbrew_inventory;
create policy "team full access" on public.oddbrew_inventory
  for all to authenticated using (true) with check (true);
