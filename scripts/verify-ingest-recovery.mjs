import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { writeBatches } from '../server/src/ingest/batches.ts';
import { landRawPostings, markRawProcessed, normalize } from '../server/src/ingest/pipeline.ts';
import { resolveCompaniesByName, chunk } from '../server/src/ingest/db.ts';
import { compileDictionary } from '../server/src/ingest/normalize/skills.ts';
import { withoutDirectDuplicates } from '../server/src/ingest/aggregators/simplify.ts';

// Fixed local CLI credentials. This test never reads server/.env or a hosted URL.
const db = createClient('http://127.0.0.1:54721',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU',
  { auth: { persistSession: false } });
const totals = () => ({ postingsSeen: 0, rawInserted: 0, jobsCreated: 0, jobsUpdated: 0, collapsed: 0, duplicates: 0 });
const checked = (result) => { assert.equal(result.error, null, result.error?.message); return result.data; };

test('statement timeouts split transactions without losing or duplicating rows', async () => {
  const committed = [];
  await writeBatches([1, 2, 3, 4, 5], 5, 'test', async (batch) => {
    if (batch.length > 2) throw { code: '57014', message: 'statement timeout' };
    committed.push(...batch);
  });
  assert.deepEqual(committed, [1, 2, 3, 4, 5]);
});

test('permanent errors and single-row timeouts fail visibly', async () => {
  for (const code of ['23514', '57014']) {
    let attempts = 0;
    await assert.rejects(writeBatches([1], 50, 'reconcile', async () => {
      attempts++;
      throw { code, message: 'cannot write' };
    }), new RegExp(`reconcile.*${code}`));
    assert.equal(attempts, 1);
  }
});

test('an aggregator preserves direct employer content but keeps distinct roles and locations', () => {
  const direct = { company_id: 'acme', title_normalized: 'software summer 2027', location_city: null, seniority: 'intern' };
  const otherCity = { ...direct, location_city: 'Seattle' };
  const otherCohort = { ...direct, title_normalized: 'software summer 2028' };
  assert.deepEqual(withoutDirectDuplicates([direct, otherCity, otherCohort], [direct]), [otherCity, otherCohort]);
});

test('an interrupted import is retried; only acknowledged current versions are skipped', async () => {
  const stamp = `ingest-recovery-${crypto.randomUUID()}`;
  const company = checked(await db.from('companies').insert({ slug: stamp, name: stamp }).select('id').single());
  try {
    const source = checked(await db.from('job_sources').insert({
      company_id: company.id, kind: 'greenhouse', board_url: `https://example.invalid/${stamp}`,
    }).select('id').single());
    const posting = { externalId: 'one', payload: { title: 'Software Engineer Intern', revision: 1 } };
    const firstTotals = totals();
    const first = await landRawPostings(db, source.id, null, [posting], firstTotals);
    assert.equal(first.length, 1);
    assert.equal(firstTotals.rawInserted, 1);
    // Simulate a process dying after landing raw data, before reconciling jobs.
    const retryTotals = totals();
    const retry = await landRawPostings(db, source.id, null, [posting], retryTotals);
    assert.equal(retry.length, 1);
    assert.equal(retryTotals.rawInserted, 0);
    assert.equal(retry[0].rawId, first[0].rawId);
    const jobs = normalize({
      externalId: 'one', title: posting.payload.title, locationRaw: 'San Francisco, CA', extraLocations: [],
      descriptionHtml: null, descriptionText: 'Build software as a summer intern.',
      applyUrl: 'https://example.invalid/apply', postedAt: null, closesAt: null,
      employmentTypeHint: 'Internship', workplaceHint: null, salary: null, department: null,
    }, { companyId: company.id, companyName: stamp, companyDomain: null, sourceId: source.id,
      runId: null, applyHost: 'greenhouse', dictionary: compileDictionary([]), boardSize: 1 });
    const written = checked(await db.rpc('ingest_upsert_jobs', { p_rows: jobs }));
    assert.equal(written.created, 1);
    await markRawProcessed(db, retry);
    assert.equal((await landRawPostings(db, source.id, null, [posting], totals())).length, 0);
    const newer = { ...posting, payload: { ...posting.payload, revision: 2 } };
    const latest = await landRawPostings(db, source.id, null, [newer], totals());
    assert.equal(latest.length, 1);
    await markRawProcessed(db, first); // an old acknowledgement cannot mark a newer version done
    assert.equal((await landRawPostings(db, source.id, null, [newer], totals())).length, 1);
    assert.equal((await landRawPostings(db, source.id, null, [posting], totals())).length, 0);
    await markRawProcessed(db, latest);
    assert.equal((await landRawPostings(db, source.id, null, [newer], totals())).length, 0);
    assert.equal(checked(await db.from('jobs').select('id').eq('source_id', source.id)).length, 1);
  } finally {
    checked(await db.from('companies').delete().eq('id', company.id));
  }
});

test('company resolution spans max_rows and does not duplicate case variants or slug collisions', async () => {
  const stamp = `recovery-${crypto.randomUUID()}`;
  const names = Array.from({ length: 1005 }, (_, i) => `${stamp} Company ${i}`);
  try {
    const resolved = await resolveCompaniesByName(db, [...names, names[0].toUpperCase()]);
    assert.equal(resolved.size, 1006);
    assert.equal(resolved.get(names[0]), resolved.get(names[0].toUpperCase()));
    assert.equal(new Set(resolved.values()).size, 1005);
    const again = await resolveCompaniesByName(db, names);
    assert.deepEqual(again, new Map(names.map((name) => [name, resolved.get(name)])));
    const collision = await resolveCompaniesByName(db, [names[0].replace('Company', 'Company!')]);
    assert.equal(collision.size, 1);
    assert.notEqual([...collision.values()][0], resolved.get(names[0]));
  } finally {
    for (;;) {
      const rows = checked(await db.from('companies').select('id').like('slug', `${stamp}%`).limit(500));
      if (rows.length === 0) break;
      for (const ids of chunk(rows.map((row) => row.id))) {
        checked(await db.from('companies').delete().in('id', ids));
      }
    }
  }
});
