-- Blender render queue. The portal inserts jobs; a local render agent on your
-- PC (see the blender/ folder) picks them up, renders, and writes the result
-- back. Run once in the Supabase SQL Editor of an existing project.
create table if not exists public.render_jobs (
  id text primary key,
  status text not null default 'queued',   -- queued | rendering | done | failed
  params jsonb not null default '{}'::jsonb,
  card_image text,     -- base64 data URL input
  art_image text,      -- base64 data URL input
  result_image text,   -- base64 data URL output
  error text,
  created_by text,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.render_jobs enable row level security;

-- Signed-in team members submit and view jobs. The render agent connects with
-- the service-role key (bypasses RLS) from your trusted PC.
create policy "team full access" on public.render_jobs
  for all to authenticated using (true) with check (true);
