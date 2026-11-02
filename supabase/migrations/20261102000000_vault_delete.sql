-- Removes a stored Meta token when a workspace disconnects Meta or is deleted.

create or replace function public.vault_delete_secret(p_id uuid)
returns void
language sql
security definer
set search_path = public, vault
as $$
  delete from vault.secrets where id = p_id;
$$;

revoke all on function public.vault_delete_secret(uuid) from public, anon, authenticated;
grant execute on function public.vault_delete_secret(uuid) to service_role;
