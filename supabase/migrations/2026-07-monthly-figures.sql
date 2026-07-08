-- Monthly figures (manager's operating summary) — run once in the Supabase
-- SQL Editor of an EXISTING project. Fresh installs get this via schema.sql.

create table public.monthly_figures (
  id text primary key, -- "YYYY-MM"
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.monthly_figures enable row level security;

create policy "team full access" on public.monthly_figures
  for all to authenticated using (true) with check (true);

alter publication supabase_realtime add table public.monthly_figures;
