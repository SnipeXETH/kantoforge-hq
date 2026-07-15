-- OddBrew: a separate Shopify store, isolated from KantoForge. Its orders and
-- config live in their own tables, fetched only by the OddBrew page.
-- Run once in Supabase → SQL Editor. Safe to re-run. No realtime line (so it
-- can't hit the publication deadlock).

create table if not exists public.oddbrew_orders (
  id text primary key,
  order_date timestamptz,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists oddbrew_orders_date on public.oddbrew_orders (order_date);

create table if not exists public.oddbrew_config (
  id int primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.oddbrew_config (id, data) values (1, '{}'::jsonb) on conflict (id) do nothing;

alter table public.oddbrew_orders enable row level security;
alter table public.oddbrew_config enable row level security;

drop policy if exists "team full access" on public.oddbrew_orders;
create policy "team full access" on public.oddbrew_orders
  for all to authenticated using (true) with check (true);

drop policy if exists "team full access" on public.oddbrew_config;
create policy "team full access" on public.oddbrew_config
  for all to authenticated using (true) with check (true);
