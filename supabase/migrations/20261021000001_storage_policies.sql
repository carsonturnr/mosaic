-- Storage: creatives bucket holds originals and keyframes under
--   {workspace_id}/{creative_id}/original.<ext>
--   {workspace_id}/{creative_id}/scene_<idx>.jpg
-- The worker (service role) writes; workspace owners may read their own files.

create policy "owner reads workspace creatives"
on storage.objects for select
to authenticated
using (
  bucket_id = 'creatives'
  and owns_workspace(((storage.foldername(name))[1])::uuid)
);
