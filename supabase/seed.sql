-- Default taxonomy (docs/ARCHITECTURE.md §8). workspace_id null = system default, editable per workspace later.
insert into taxonomy_dimensions (workspace_id, key, label, description, allowed_values, applies_to) values
  (null, 'hook_type', 'Hook type', 'How the first 3 seconds grab attention',
   '["problem/pain","curiosity/question","bold claim","stat/number","demo/visual","testimonial","us-vs-them","pattern interrupt","offer-first"]', 'hook'),
  (null, 'angle', 'Angle', 'The core persuasive argument of the ad',
   '["performance/results","convenience","price/value","quality/ingredients","social proof","identity/lifestyle","problem-solution","comparison"]', 'ad'),
  (null, 'persona', 'Persona', 'Who the ad speaks to (free text, normalized by clustering)', null, 'ad'),
  (null, 'format', 'Format', 'Production format',
   '["UGC","talking head","product demo","montage/B-roll","static image","carousel","text-on-screen","founder story"]', 'ad'),
  (null, 'offer', 'Offer', 'Promotion shown in the ad',
   '["none","% discount","$ off","free shipping","bundle","free gift","trial"]', 'ad'),
  (null, 'proof_type', 'Proof type', 'Evidence used to back the claim',
   '["none","reviews/stars","testimonial","before/after","expert","data/stat","press"]', 'ad'),
  (null, 'cta', 'CTA', 'Call to action',
   '["shop now","learn more","sign up","get offer","other"]', 'ad'),
  (null, 'length_bucket', 'Length', 'Video length bucket',
   '["<=15s","16-30s","31-60s",">60s","static"]', 'ad')
on conflict (workspace_id, key) do nothing;
