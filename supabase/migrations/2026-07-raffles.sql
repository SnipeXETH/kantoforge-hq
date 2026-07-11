-- Raffles / prize competitions. Run once in the Supabase SQL Editor of an
-- EXISTING project. Fresh installs get this via schema.sql.

create table if not exists public.competitions (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.raffle_entries (
  id text primary key,
  competition_id text,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists raffle_entries_comp on public.raffle_entries (competition_id);

alter table public.competitions enable row level security;
alter table public.raffle_entries enable row level security;

create policy "team full access" on public.competitions
  for all to authenticated using (true) with check (true);
create policy "team full access" on public.raffle_entries
  for all to authenticated using (true) with check (true);

alter publication supabase_realtime add table public.competitions, public.raffle_entries;
