-- OddBrew supplier-invoice ledger. Each row is one reconciled invoice.
-- Run once in Supabase → SQL Editor. Safe to re-run.

create table if not exists public.oddbrew_invoices (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.oddbrew_invoices enable row level security;

drop policy if exists "team full access" on public.oddbrew_invoices;
create policy "team full access" on public.oddbrew_invoices
  for all to authenticated using (true) with check (true);
