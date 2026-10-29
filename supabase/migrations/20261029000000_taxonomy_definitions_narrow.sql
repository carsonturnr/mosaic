-- Narrow three definitions that over-applied on the first labeled sample: any creator
-- became a testimonial, and a tie-break pushed lifestyle ads to performance/results.

update taxonomy_dimensions set description = 'The strongest evidence behind the claim. testimonial: a person describing results they personally got from the product; a creator who only presents or recommends it is not proof. before/after: a change over time, shown or described. expert: a doctor, dietitian, scientist or other credentialed person. reviews/stars: star ratings or quoted reviews. data/stat: numbers or studies. press: media logos or quotes. none: no evidence at all.'
where workspace_id is null and key = 'proof_type';

update taxonomy_dimensions set description = 'The main reason to buy, judged across the whole ad rather than the hook. performance/results: a specific outcome (energy, digestion, sleep, focus). convenience: easier or faster than the alternatives ("one scoop replaces…"). price/value: cost or savings. quality/ingredients: what is in it and how it is made. social proof: how many people use or love it, as the main argument. identity/lifestyle: the kind of person or routine it fits, with no specific outcome promised. problem-solution: a named problem, then the product fixing it. comparison: explicitly against a named alternative.'
where workspace_id is null and key = 'angle';

update taxonomy_dimensions set description = 'The promotion shown or said in the ad. trial: a free trial, free sample or money-back guarantee. bundle: products sold together. none: no promotion at all, even if the price is mentioned. If there are several, pick the one the ad leads with.'
where workspace_id is null and key = 'offer';
