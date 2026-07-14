-- Print shop: canvas mockup templates. Each row is one mockup (photo + the
-- four-corner region where artwork is placed). Run once in Supabase → SQL Editor.

create table if not exists public.print_mockups (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.print_mockups enable row level security;

create policy "team full access" on public.print_mockups
  for all to authenticated using (true) with check (true);
