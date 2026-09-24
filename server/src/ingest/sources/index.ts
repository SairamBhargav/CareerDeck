/**
 * Kind → adapter. The only place the pipeline learns that more than one ATS exists.
 *
 * docs/README.md §4.2's sequencing: "Greenhouse + Lever + Ashby gets you a large majority
 * of startup/tech internship and new-grad postings — precisely your market — for a
 * fraction of the effort. Ship on those three." Those three shipped first, and Workday
 * followed once the corpus was real — it is the ATS the large employers use, so it is the
 * one that decides whether a student sees NVIDIA and Salesforce alongside the startups.
 *
 * SmartRecruiters and bespoke career sites are still declared in the `ats_kind` enum with
 * no adapter; a source row of one of those kinds is skipped with a clear message rather
 * than crashing a run.
 */

import { ashby } from './ashby.ts';
import { greenhouse } from './greenhouse.ts';
import { lever } from './lever.ts';
import { workday } from './workday.ts';
import type { AtsKind, SourceAdapter } from './types.ts';

const ADAPTERS: Partial<Record<AtsKind, SourceAdapter>> = {
  greenhouse,
  lever,
  ashby,
  workday,
};

export function adapterFor(kind: AtsKind): SourceAdapter | null {
  return ADAPTERS[kind] ?? null;
}

export const SUPPORTED_KINDS = Object.keys(ADAPTERS) as AtsKind[];

export { ashby, greenhouse, lever, workday };
export type { AtsKind, ParsedPosting, RawPosting, SourceAdapter, SourcePage, SourceRef } from './types.ts';
