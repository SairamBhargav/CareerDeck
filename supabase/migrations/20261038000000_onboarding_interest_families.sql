/*
 * Onboarding v2's interests, mapped to job families.
 *
 * The interests step was cut from a forty-field grid to twenty-one picks covering what the
 * corpus actually holds: software and tech, the engineering disciplines, and finance and
 * business. Eight of them reuse sector keys that already had rows here (Software
 * Development, AI, Data Science, Cybersecurity, Finance, Banking, Business Operations,
 * Accounting). The thirteen below are new keys, and without a row a pick contributes
 * nothing to `user_job_families()`. That is survivable, but it is the whole point of asking.
 *
 * Quant & Trading maps to three families on purpose: the same desks hire traders
 * (business), researchers (data_ml) and developers (software), and a student who taps it
 * means any of the three.
 *
 * Additive only. Old keys keep their rows, so everybody who onboarded on the forty-field
 * grid keeps the families they already have.
 */
insert into public.sector_families (sector_key, family) values
  ('cloud-infrastructure', 'software'),
  ('electrical-engineering', 'hardware'),
  ('computer-hardware', 'hardware'),
  ('mechanical-engineering', 'hardware'),
  ('aerospace-engineering', 'hardware'),
  ('robotics', 'hardware'), ('robotics', 'software'),
  ('civil-engineering', 'hardware'),
  ('chemical-engineering', 'hardware'),
  ('industrial-engineering', 'hardware'), ('industrial-engineering', 'operations'),
  ('quant-trading', 'business'), ('quant-trading', 'data_ml'), ('quant-trading', 'software'),
  ('fintech', 'business'), ('fintech', 'software'),
  ('consulting', 'business'),
  ('product-management', 'product')
on conflict do nothing;
