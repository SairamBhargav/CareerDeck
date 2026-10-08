import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { useAuth } from '@/context/AuthContext';
import { fetchGifPage, fetchGifsBySlug, isKlipyConfigured, type KlipyGif } from '@/lib/klipy';

/** Long enough that a pause between words does not spend a request on half a word. */
const SEARCH_DEBOUNCE_MS = 350;

/**
 * The picker's grid: trending while the box is empty, search results once something is typed.
 *
 * Testing-mode keys get 100 requests an hour, so the debounce and the cache matter: reopening
 * the picker, or retyping a search from a minute ago, is served from memory.
 */
export function useGifSearch(query: string, enabled: boolean) {
  const { userId } = useAuth();
  const [typed, setTyped] = useState(query.trim());

  useEffect(() => {
    const timer = setTimeout(() => setTyped(query.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  // Clearing the box goes straight back to trending; only typing waits.
  const debounced = query.trim().length === 0 ? '' : typed;

  const result = useInfiniteQuery({
    queryKey: ['klipy', 'page', debounced.toLowerCase()],
    queryFn: ({ pageParam, signal }) => fetchGifPage({ query: debounced, page: pageParam, userId, signal }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasNext ? last.page + 1 : undefined),
    enabled: enabled && isKlipyConfigured,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    retry: 1,
  });

  /*
   * Flattened in KLIPY's order, which their terms require us to keep. A GIF that appears on two
   * pages (trending shifts while you scroll) is shown once, at its first position.
   */
  const seen = new Set<string>();
  const gifs: KlipyGif[] = [];
  for (const page of result.data?.pages ?? []) {
    for (const gif of page.gifs) {
      if (seen.has(gif.slug)) continue;
      seen.add(gif.slug);
      gifs.push(gif);
    }
  }

  return {
    gifs,
    isSearching: debounced.length > 0,
    isLoading: result.isLoading,
    isError: result.isError,
    hasMore: result.hasNextPage,
    loadMore: () => {
      if (result.hasNextPage && !result.isFetchingNextPage) void result.fetchNextPage();
    },
    isLoadingMore: result.isFetchingNextPage,
    retry: () => void result.refetch(),
  };
}

/*
 * Every comment row with a KLIPY GIF asks for its own slug, and a thread renders a dozen rows
 * in one frame. Requests made within one tick are collected and sent as one Items call, so a
 * thread costs one request rather than one per GIF.
 */
let pending = new Map<string, ((gif: KlipyGif | null) => void)[]>();
let failing = new Map<string, ((error: unknown) => void)[]>();
let timer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  timer = null;
  const batch = pending;
  const rejects = failing;
  pending = new Map();
  failing = new Map();
  fetchGifsBySlug([...batch.keys()]).then(
    (found) => {
      for (const [slug, resolvers] of batch) for (const resolve of resolvers) resolve(found.get(slug) ?? null);
    },
    (error: unknown) => {
      if (__DEV__) console.warn('[klipy] items lookup failed', error);
      for (const callbacks of rejects.values()) for (const reject of callbacks) reject(error);
    },
  );
}

function loadGif(slug: string): Promise<KlipyGif | null> {
  return new Promise((resolve, reject) => {
    pending.set(slug, [...(pending.get(slug) ?? []), resolve]);
    failing.set(slug, [...(failing.get(slug) ?? []), reject]);
    timer ??= setTimeout(flush, 16);
  });
}

/** One comment's GIF. `null` data means KLIPY no longer serves it; the row then shows no GIF. */
export function useKlipyGif(slug: string | null) {
  return useQuery({
    queryKey: ['klipy', 'gif', slug],
    queryFn: () => loadGif(slug as string),
    enabled: slug !== null && isKlipyConfigured,
    // A posted GIF does not change, so a found one is kept for an hour. "Not found" is not kept
    // at all: it may only have been a bad moment, and an hour of a missing GIF is a bug report.
    staleTime: (query) => (query.state.data ? 60 * 60_000 : 0),
    gcTime: 2 * 60 * 60_000,
    retry: 1,
  });
}
