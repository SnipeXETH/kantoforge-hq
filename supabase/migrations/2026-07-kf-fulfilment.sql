-- KantoForge fulfilment invoices: actual per-order Royal Mail postage, Total
-- Cards fee and DDP, parsed from Cameron's Detailed invoice spreadsheet.
-- id = normalised order number (e.g. 'KF56842'). Run once in Supabase.

create table if not exists public.kf_fulfilment (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.kf_fulfilment enable row level security;

drop policy if exists "team full access" on public.kf_fulfilment;
create policy "team full access" on public.kf_fulfilment
  for all to authenticated using (true) with check (true);
