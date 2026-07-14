-- Image storage: large uploads (commission cards, finished artwork) go to a
-- Storage bucket instead of inline in realtime-synced rows. Run once in
-- Supabase → SQL Editor. Safe to re-run.

insert into storage.buckets (id, name, public, file_size_limit)
values ('kf-assets', 'kf-assets', true, 52428800) -- 50 MB
on conflict (id) do update set public = true, file_size_limit = 52428800;

-- Public read (unguessable paths); signed-in team can upload/change/remove.
drop policy if exists "kf assets read" on storage.objects;
create policy "kf assets read" on storage.objects
  for select using (bucket_id = 'kf-assets');

drop policy if exists "kf assets insert" on storage.objects;
create policy "kf assets insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'kf-assets');

drop policy if exists "kf assets update" on storage.objects;
create policy "kf assets update" on storage.objects
  for update to authenticated using (bucket_id = 'kf-assets');

drop policy if exists "kf assets delete" on storage.objects;
create policy "kf assets delete" on storage.objects
  for delete to authenticated using (bucket_id = 'kf-assets');
