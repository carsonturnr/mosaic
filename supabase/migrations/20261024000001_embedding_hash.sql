-- Re-embed a creative only when its text changes (docs/ARCHITECTURE.md §4: cache aggressively).
alter table creative_embeddings add column if not exists content_hash text;
create unique index if not exists creative_embeddings_one_per_kind
  on creative_embeddings (creative_id, kind, model) where scene_id is null;
-- Concept clusters: one run per workspace is kept; add the diversity summary to the run.
alter table concept_clusters add column if not exists spend numeric;
alter table concept_clusters add column if not exists diversity numeric;
