-- Per-user page access. Run once in the Supabase SQL Editor of an EXISTING
-- project. Fresh installs get this via schema.sql. Null access = full access.
alter table public.profiles add column if not exists access jsonb;
