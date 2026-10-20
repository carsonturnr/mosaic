-- Vault helpers so the worker (service role) can store and read Meta tokens by id
-- without exposing the vault schema through PostgREST. Never callable by clients.

create or replace function public.vault_store_secret(p_name text, p_secret text)
returns uuid
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  existing uuid;
begin
  select id into existing from vault.secrets where name = p_name;
  if existing is not null then
    perform vault.update_secret(existing, p_secret, p_name);
    return existing;
  end if;
  return vault.create_secret(p_secret, p_name);
end;
$$;

create or replace function public.vault_read_secret(p_id uuid)
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret from vault.decrypted_secrets where id = p_id;
$$;

revoke all on function public.vault_store_secret(text, text) from public, anon, authenticated;
revoke all on function public.vault_read_secret(uuid) from public, anon, authenticated;
grant execute on function public.vault_store_secret(text, text) to service_role;
grant execute on function public.vault_read_secret(uuid) to service_role;
