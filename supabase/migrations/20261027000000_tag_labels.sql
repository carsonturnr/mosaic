-- Hand labels for the tagging-accuracy eval (docs/ARCHITECTURE.md §12). Kept apart from
-- creative_tags so labeling stays blind and never changes what the analysis uses.
create table tag_labels (
  creative_id uuid not null references creatives(id) on delete cascade,
  dimension_key text not null,
  value text not null,
  labeled_at timestamptz not null default now(),
  primary key (creative_id, dimension_key)
);
alter table tag_labels enable row level security;
create policy "owner manages tag labels" on tag_labels for all
  using (exists (select 1 from creatives c where c.id = creative_id and owns_workspace(c.workspace_id)))
  with check (exists (select 1 from creatives c where c.id = creative_id and owns_workspace(c.workspace_id)));
