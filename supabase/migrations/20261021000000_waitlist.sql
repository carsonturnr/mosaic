-- Waitlist sign-ups from the marketing sites. Anyone may insert; only the service
-- role reads. Shared by Mosaic and Stride Lab until the latter has its own project.

create table waitlist (
  id uuid primary key default gen_random_uuid(),
  product text not null check (product in ('mosaic', 'stride_lab')),
  email text not null check (position('@' in email) > 1),
  source text,
  created_at timestamptz not null default now(),
  unique (product, email)
);

alter table waitlist enable row level security;
create policy "anyone can join the waitlist" on waitlist for insert
  to anon, authenticated with check (true);
-- no select/update/delete policies: reads go through the service role only
