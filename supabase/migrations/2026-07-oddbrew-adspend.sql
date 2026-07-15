-- OddBrew ad spend (Meta), one row per day. id = 'YYYY-MM-DD'.
-- Run once in Supabase → SQL Editor. Safe to re-run.

create table if not exists public.oddbrew_adspend (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.oddbrew_adspend enable row level security;

drop policy if exists "team full access" on public.oddbrew_adspend;
create policy "team full access" on public.oddbrew_adspend
  for all to authenticated using (true) with check (true);
