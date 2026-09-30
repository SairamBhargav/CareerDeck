/*
 * The seven Workday employers scripts/board-list.ts gained on 2026-09-29 (NVIDIA, Salesforce,
 * Adobe, Capital One, Mastercard, PayPal, Workday), as companies and as crawl sources.
 *
 * board-list.ts only reaches a database through the seed, and `db push` does not run the seed,
 * so on the hosted project these employers were never crawled. Worse, onboarding's follow
 * step (constants/industries.ts) offers them: PayPal and Workday had no company row at all,
 * so a student who followed either lost that follow silently. Reference data the production
 * database cannot work without belongs in a migration (the same reasoning as
 * 20261003000000_school_picker.sql).
 *
 * Values generated from board-list.ts's own boardUrlFor / logoUrlFor / monogramFor, not typed.
 *
 * Five of the companies already existed, created by the Simplify feed with only a name. The
 * upsert fills what is blank and changes nothing that is set: NVIDIA keeps its existing
 * industry label.
 */

set lock_timeout = '10s';

with board (slug, name, domain, logo_url, logo_monogram, logo_color, industry, board_url, board_token) as (
  values
    ('nvidia', 'NVIDIA', 'nvidia.com', 'https://www.google.com/s2/favicons?sz=128&domain_url=nvidia.com', 'NV', '#76B900', 'Accelerated Computing', 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite', 'NVIDIAExternalCareerSite'),
    ('salesforce', 'Salesforce', 'salesforce.com', 'https://www.google.com/s2/favicons?sz=128&domain_url=salesforce.com', 'SA', '#00A1E0', 'Customer Platform', 'https://salesforce.wd12.myworkdayjobs.com/External_Career_Site', 'External_Career_Site'),
    ('adobe', 'Adobe', 'adobe.com', 'https://www.google.com/s2/favicons?sz=128&domain_url=adobe.com', 'AD', '#FF0000', 'Creative Software', 'https://adobe.wd5.myworkdayjobs.com/external_experienced', 'external_experienced'),
    ('capital-one', 'Capital One', 'capitalone.com', 'https://www.google.com/s2/favicons?sz=128&domain_url=capitalone.com', 'CO', '#004977', 'Consumer Banking', 'https://capitalone.wd12.myworkdayjobs.com/Capital_One', 'Capital_One'),
    ('mastercard', 'Mastercard', 'mastercard.com', 'https://www.google.com/s2/favicons?sz=128&domain_url=mastercard.com', 'MA', '#EB001B', 'Payments Network', 'https://mastercard.wd1.myworkdayjobs.com/CorporateCareers', 'CorporateCareers'),
    ('paypal', 'PayPal', 'paypal.com', 'https://www.google.com/s2/favicons?sz=128&domain_url=paypal.com', 'PA', '#003087', 'Digital Payments', 'https://paypal.wd1.myworkdayjobs.com/jobs', 'jobs'),
    ('workday', 'Workday', 'workday.com', 'https://www.google.com/s2/favicons?sz=128&domain_url=workday.com', 'WO', '#0875E1', 'Enterprise HR', 'https://workday.wd5.myworkdayjobs.com/Workday', 'Workday')
),
companies as (
  insert into public.companies (slug, name, domain, logo_url, logo_monogram, logo_color, industry)
  select slug, name, domain, logo_url, logo_monogram, logo_color, industry from board
  on conflict (slug) do update set
    domain        = coalesce(public.companies.domain, excluded.domain),
    logo_url      = coalesce(public.companies.logo_url, excluded.logo_url),
    logo_monogram = coalesce(public.companies.logo_monogram, excluded.logo_monogram),
    logo_color    = coalesce(public.companies.logo_color, excluded.logo_color),
    industry      = coalesce(public.companies.industry, excluded.industry)
  returning id, slug
)
/*
 * Nightly, like every other board. The crawler scopes a Workday listing to US/Canada and
 * student-level roles *before* fetching each posting's detail page (pipeline.ts), which is
 * what makes a board NVIDIA's size affordable on the free plan.
 */
insert into public.job_sources (company_id, kind, board_url, board_token, crawl_interval)
select c.id, 'workday', b.board_url, b.board_token, interval '24 hours'
  from board b
  join companies c on c.slug = b.slug
on conflict (kind, board_url) do nothing;
