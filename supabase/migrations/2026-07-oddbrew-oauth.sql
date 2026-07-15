-- OddBrew live sync via Shopify OAuth. The offline Admin API token is stored
-- server-side only: RLS is enabled with NO policies, so signed-in clients can
-- read nothing here — only the serverless functions (service role, which
-- bypasses RLS) can read/write it. Run once in Supabase → SQL Editor.

create table if not exists public.oddbrew_secrets (
  id int primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.oddbrew_secrets (id, data) values (1, '{}'::jsonb) on conflict (id) do nothing;

alter table public.oddbrew_secrets enable row level security;
-- Intentionally no policies: the Shopify token is never exposed to the browser.
