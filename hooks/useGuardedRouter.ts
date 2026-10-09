import { useRouter } from 'expo-router';
import { useMemo } from 'react';

/**
 * Two taps on the same destination inside this window are one tap.
 *
 * Long enough to cover a double tap and the gap before the next screen has drawn — which
 * is the whole window in which the first push is invisible and a second feels warranted.
 * Short enough that genuinely going back and opening the same thing again still works.
 */
const REPEAT_MS = 700;

/*
 * Module scope rather than a ref, deliberately.
 *
 * The screen that issued the first push is often the one unmounting because of it, so a
 * guard living in its state would be torn down exactly when the second tap needs it. The
 * navigation stack is global, so what protects it has to be too.
 */
let lastKey = '';
let lastAt = 0;

function claim(href: unknown): boolean {
  // Objects, because most pushes here are `{ pathname, params }`. Key order is stable
  // across two taps on one handler, which is all this has to survive.
  const key = typeof href === 'string' ? href : JSON.stringify(href);
  const now = Date.now();
  if (key === lastKey && now - lastAt < REPEAT_MS) return false;
  lastKey = key;
  lastAt = now;
  return true;
}

/**
 * `useRouter`, with repeat pushes to the same place dropped.
 *
 * Tapping a card twice before the next screen has drawn pushed it twice, leaving the
 * reader to dismiss two identical screens — most visible on the suggestion cards, where
 * the targets are small and close together, but true of every list in the app.
 *
 * Keyed on the destination rather than on time alone, so this only ever swallows a repeat
 * of the same thing. Opening a company and then immediately opening a job from it is two
 * different destinations and both go through.
 *
 * Only `push` is guarded. `back`, `replace` and `dismiss` are idempotent enough in
 * practice, and a guarded `back` would be a way to get stuck.
 */
export function useGuardedRouter(): ReturnType<typeof useRouter> {
  const router = useRouter();

  return useMemo(
    () => ({
      ...router,
      push: ((href: Parameters<typeof router.push>[0]) => {
        if (claim(href)) router.push(href);
      }) as typeof router.push,
    }),
    [router],
  );
}
