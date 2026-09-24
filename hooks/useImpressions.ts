import { useCallback, useEffect, useRef } from 'react';
import { AppState, type ViewToken } from 'react-native';

import type { FeedSurface } from '@/lib/api';
import { flushImpressions, recordImpression } from '@/lib/impressions';

/**
 * Impression logging, per surface — README §3.6.
 *
 * Three shapes, because the app has three kinds of list and they can answer different
 * questions:
 *
 *  - `useListImpressions` for a virtualized list (Home, search). Viewability tells it when
 *    a card is actually on screen, and the row's index is its position in the feed.
 *  - `useDwellImpressions` for Reels. The same signal, plus the one §3.6 calls "the
 *    strongest implicit signal you have and the reason a Reels-style UI is worth the
 *    trouble": how long the card was the active page, and whether the reader moved on or
 *    went back.
 *  - `useRenderedImpressions` for a short mapped list inside a ScrollView (a company's
 *    openings, a collection). Everything in one is mounted at once, so there is no
 *    viewability to read — the impression is logged when it renders.
 *
 * Every one of them de-duplicates per mount. Viewability fires on scroll direction changes
 * and on re-renders, and without that guard a slow scroll past one card would log it six
 * times. Re-showing a card in a *new* session is a real impression and is logged again.
 */

const VIEWABILITY = {
  /** Half on screen, held there. Anything looser logs cards that were scrolled past. */
  itemVisiblePercentThreshold: 50,
  minimumViewTime: 250,
} as const;

/** A Reels page counts as seen once it is most of the screen — it is paged, not scrolled. */
const PAGE_VIEWABILITY = {
  itemVisiblePercentThreshold: 80,
} as const;

function idOf(token: ViewToken): string | null {
  const item = token.item as { id?: unknown } | null;
  return item && typeof item.id === 'string' ? item.id : null;
}

export interface ListImpressionOptions {
  /**
   * False while the list is showing something other than jobs. The search overlay's one
   * list renders companies under the other tab, and a company id logged as a job id is a
   * row that will never join to anything.
   */
  enabled?: boolean;
  /**
   * Changes when the list becomes a *different* list rather than a longer one. Home's
   * sort bar and the search query both qualify: the same card at a new rank, after a new
   * query, is a new impression. Paging in more results is not.
   */
  resetKey?: string;
}

/**
 * Viewability-driven logging for a virtualized list.
 *
 * Returns props to spread onto the list. `viewabilityConfigCallbackPairs` has to be
 * referentially stable — React Native throws "Changing viewabilityConfigCallbackPairs on
 * the fly is not supported" otherwise — which is why the callback reads everything it
 * needs out of refs rather than closing over it.
 */
export function useListImpressions(surface: FeedSurface, options: ListImpressionOptions = {}) {
  const { enabled = true, resetKey = '' } = options;

  const config = useRef({ surface, enabled });
  config.current = { surface, enabled };

  const seen = useRef<Set<string>>(new Set());

  const pairs = useRef([
    {
      viewabilityConfig: VIEWABILITY,
      onViewableItemsChanged: ({ viewableItems }: { viewableItems: ViewToken[] }) => {
        if (!config.current.enabled) return;

        for (const token of viewableItems) {
          const id = idOf(token);
          if (id === null || seen.current.has(id)) continue;
          seen.current.add(id);
          recordImpression({ jobId: id, surface: config.current.surface, position: token.index });
        }
      },
    },
  ]);

  useEffect(() => {
    seen.current = new Set();
  }, [surface, resetKey]);

  return { viewabilityConfigCallbackPairs: pairs.current };
}

interface ActivePage {
  jobId: string;
  position: number;
  since: number;
}

/**
 * Dwell logging for Reels.
 *
 * One impression per card, written when the reader leaves it rather than when they arrive,
 * because the interesting number is only known at that point. `completed` is true when the
 * next card is further down the feed and false when it is further up — scrolled past
 * versus bounced back, §3.6's words.
 *
 * Leaving the screen entirely settles the current card with `completed: null`. That is not
 * a missing value being papered over: closing the tab is neither moving on nor going back,
 * and recording it as either would put a thumb on the scale of the one signal phase 5 is
 * going to lean on hardest.
 */
export function useDwellImpressions(surface: FeedSurface = 'reels') {
  const active = useRef<ActivePage | null>(null);
  const surfaceRef = useRef(surface);
  surfaceRef.current = surface;

  const settle = useCallback((next: { jobId: string; position: number } | null) => {
    const previous = active.current;

    if (previous && previous.jobId !== next?.jobId) {
      recordImpression({
        jobId: previous.jobId,
        surface: surfaceRef.current,
        position: previous.position,
        dwellMs: Date.now() - previous.since,
        completed: next ? next.position > previous.position : null,
      });
    }

    active.current =
      next === null
        ? null
        : previous && previous.jobId === next.jobId
          ? previous
          : { ...next, since: Date.now() };
  }, []);

  // The stable callback below needs the latest `settle`; `settle` is stable itself, but
  // going through a ref keeps that an implementation detail rather than a requirement.
  const settleRef = useRef(settle);
  settleRef.current = settle;

  const pairs = useRef([
    {
      viewabilityConfig: PAGE_VIEWABILITY,
      onViewableItemsChanged: ({ viewableItems }: { viewableItems: ViewToken[] }) => {
        // Paging means at most one card is ever 80% visible, so the first is the active
        // one. An empty list here is a momentary state mid-swipe, not a departure.
        const token = viewableItems[0];
        if (!token) return;
        const id = idOf(token);
        if (id === null) return;
        settleRef.current({ jobId: id, position: token.index ?? 0 });
      },
    },
  ]);

  useEffect(() => {
    // A card the user was looking at when they backgrounded the app is a card they dwelt
    // on until that moment — not one they are still on when they come back tomorrow.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        settleRef.current(null);
        void flushImpressions();
      }
    });

    return () => {
      subscription.remove();
      settleRef.current(null);
    };
  }, []);

  return { viewabilityConfigCallbackPairs: pairs.current, settle };
}

/**
 * Logging for a short, fully-mounted list.
 *
 * A company's openings and the Saved / Liked collections are mapped inside a ScrollView,
 * so every row exists whether or not it has been scrolled to. Logging on render is the
 * honest reading of "shown" for a list the reader can see the whole of in a flick, and
 * pretending otherwise would need a virtualized list this screen has no other reason to
 * become.
 */
export function useRenderedImpressions(surface: FeedSurface, jobs: { id: string }[]): void {
  const seen = useRef<Set<string>>(new Set());

  // The ids as one string, so the effect below fires when the list *changes* rather than
  // on every render. Callers hand over the array they already have and do not have to
  // memoise it themselves, which is the kind of requirement that gets forgotten once.
  const signature = jobs.map((job) => job.id).join(',');

  useEffect(() => {
    seen.current = new Set();
  }, [surface]);

  useEffect(() => {
    jobs.forEach((job, index) => {
      if (seen.current.has(job.id)) return;
      seen.current.add(job.id);
      recordImpression({ jobId: job.id, surface, position: index });
    });
    // `signature` stands in for `jobs`, which is a new array on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, surface]);
}
