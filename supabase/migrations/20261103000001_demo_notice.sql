-- A notice shown at the top of every page of a public demo workspace (e.g. that its
-- results are synthetic and whose ads it shows). Lives in the data, not the code.
alter table workspaces add column if not exists demo_notice text;
