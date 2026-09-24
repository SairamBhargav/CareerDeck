/**
 * Kind → adapter. The only place the pipeline learns that more than one ATS exists.
 *
 * docs/README.md §4.2's sequencing: "Greenhouse + Lever + Ashby gets you a large majority
 * of startup/tech internship and new-grad postings — precisely your market — for a
 * fraction of the effort. Ship on those three." Workday, SmartRecruiters and bespoke
 * career sites are declared in the `ats_kind` enum and have no adapter yet; a source row
 * of one of those kinds is skipped with a clear message rather than crashing a run.
 */

import { ashby } from './ashby.ts';
import { greenhouse } from './greenhouse.ts';
import { lever } from './lever.ts';
import type { AtsKind, SourceAdapter } from './types.ts';

const ADAPTERS: Partial<Record<AtsKind, SourceAdapter>> = {
  greenhouse,
  lever,
  ashby,
};

export function adapterFor(kind: AtsKind): SourceAdapter | null {
  return ADAPTERS[kind] ?? null;
}

export const SUPPORTED_KINDS = Object.keys(ADAPTERS) as AtsKind[];

export { ashby, greenhouse, lever };
export type { AtsKind, ParsedPosting, RawPosting, SourceAdapter, SourceRef } from './types.ts';
