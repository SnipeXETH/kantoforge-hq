-- Commissions workflow + role badges. Run once in the Supabase SQL Editor of
-- an EXISTING project. Fresh installs get this via schema.sql.

-- Role badges on team profiles (Founder, Artist, Operations, …)
alter table public.profiles add column if not exists badges jsonb not null default '[]'::jsonb;

-- Commission requests (card artwork extensions)
create table if not exists public.commissions (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.commissions enable row level security;

create policy "team full access" on public.commissions
  for all to authenticated using (true) with check (true);

alter publication supabase_realtime add table public.commissions;
