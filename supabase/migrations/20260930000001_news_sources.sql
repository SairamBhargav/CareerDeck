-- Phase 7 — the curated news source list.
--
-- Configuration, not fixture data, so it is a migration rather than seed.sql: the hosted project
-- needs exactly these rows and nothing that seeds a local database would put them there.
--
-- Every URL below was fetched on 2026-09-28 and answered 200 with a parseable RSS or Atom feed
-- dated within the last month. Several obvious candidates did not and are deliberately absent:
-- Anthropic, MongoDB, Amplitude and Cockroach Labs publish no feed at the guessed paths (404);
-- Coinbase and DoorDash refuse the crawler (403); Dropbox's feed 500s; Cohere, LangChain, Asana
-- and Brex redirect their feed URLs to HTML pages. PHASE7.md §2.2 has the list and the rule for
-- adding one: fetch it first.
--
-- Company feeds name their company by slug. The id is filled in here when the company already
-- exists and by the ingest otherwise, because migrations run before any seed loads companies.

insert into public.news_sources (url, name, publisher, company_slug, company_id, category)
select v.url, v.name, v.publisher, v.slug, c.id, 'company'
  from (values
    ('stripe',      'https://stripe.com/blog/feed.rss',                'Stripe Blog',             'Stripe'),
    ('openai',      'https://openai.com/news/rss.xml',                 'OpenAI News',             'OpenAI'),
    ('cloudflare',  'https://blog.cloudflare.com/rss/',                'The Cloudflare Blog',     'Cloudflare'),
    ('databricks',  'https://www.databricks.com/feed',                 'Databricks Blog',         'Databricks'),
    ('datadog',     'https://www.datadoghq.com/blog/index.xml',        'Datadog Blog',            'Datadog'),
    ('gitlab',      'https://about.gitlab.com/atom.xml',               'GitLab Blog',             'GitLab'),
    ('vercel',      'https://vercel.com/atom',                         'Vercel Blog',             'Vercel'),
    ('supabase',    'https://supabase.com/rss.xml',                    'Supabase Blog',           'Supabase'),
    ('posthog',     'https://posthog.com/rss.xml',                     'PostHog Blog',            'PostHog'),
    ('grafana',     'https://grafana.com/blog/index.xml',              'Grafana Labs Blog',       'Grafana Labs'),
    ('replit',      'https://replit.com/blog/feed.xml',                'Replit Blog',             'Replit'),
    ('figma',       'https://www.figma.com/blog/feed/atom.xml',        'Figma Blog',              'Figma'),
    ('elastic',     'https://www.elastic.co/blog/feed',                'Elastic Blog',            'Elastic'),
    ('twilio',      'https://www.twilio.com/en-us/blog.feed.xml',      'Twilio Blog',             'Twilio'),
    ('discord',     'https://discord.com/blog/rss.xml',                'Discord Blog',            'Discord'),
    ('pinterest',   'https://medium.com/feed/pinterest-engineering',   'Pinterest Engineering',   'Pinterest'),
    ('lyft',        'https://eng.lyft.com/feed',                       'Lyft Engineering',        'Lyft'),
    ('instacart',   'https://tech.instacart.com/feed',                 'Instacart Tech',          'Instacart'),
    ('duolingo',    'https://blog.duolingo.com/rss/',                  'Duolingo Blog',           'Duolingo'),
    ('reddit',      'https://www.reddit.com/r/RedditEng/.rss',         'Reddit Engineering',      'Reddit'),
    ('neon',        'https://neon.com/blog/rss.xml',                   'Neon Blog',               'Neon'),
    ('sourcegraph', 'https://sourcegraph.com/blog/feed.rss',           'Sourcegraph Blog',        'Sourcegraph'),
    ('ramp',        'https://engineering.ramp.com/rss.xml',            'Ramp Engineering',        'Ramp'),
    ('waymo',       'https://waymo.com/blog/rss.xml',                  'Waymo Blog',              'Waymo')
  ) as v (slug, url, name, publisher)
  left join public.companies c on c.slug = v.slug
on conflict (url) do nothing;

/*
 * Industry feeds. Deliberately few and deliberately narrow: most "tech news" is irrelevant to a
 * student deciding where to apply, and every item here costs a summarization. The relevance
 * score suppresses what gets through; the source list is the first filter, and the cheaper one.
 */
insert into public.news_sources (url, name, publisher, category) values
  ('https://techcrunch.com/category/startups/feed/', 'TechCrunch Startups', 'TechCrunch', 'industry'),
  ('https://techcrunch.com/tag/layoffs/feed/',       'TechCrunch Layoffs',  'TechCrunch', 'industry'),
  ('https://techcrunch.com/feed/',                   'TechCrunch',          'TechCrunch', 'industry')
on conflict (url) do nothing;
