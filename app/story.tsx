import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';

import { StoryViewer } from '@/components/stories/StoryViewer';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { useCompanyDirectory } from '@/hooks/useCompanies';
import { useStoryGroups } from '@/hooks/useStoryGroups';

/**
 * Story playback, as a screen.
 *
 * ── Why a route and not a Modal ───────────────────────────────────────────────
 *
 * It used to be a React Native `Modal` rendered inside Home. A `Modal` draws above the
 * entire navigator, which is what let it cover the floating tab bar — but it also meant no
 * pushed screen could ever appear on top of it. Tapping a company in a story header
 * therefore had to close the story before the company could be seen, and the reader
 * watched the story disappear and the page arrive separately.
 *
 * A `fullScreenModal` route covers the tab bar just the same, and is a screen in the stack,
 * so the company sheet rises over it and reveals it again on dismissal. That is the stack
 * doing its ordinary job rather than anything animated by hand here.
 *
 * It is also one fewer thing downstream of Home. As a child, every Home render — a like, a
 * follow, an arriving notification — pushed fresh props into the viewer mid-playback.
 */
export default function StoryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ group?: string; item?: string }>();
  const { markNewsSeen, toggleFollow } = useCareerDeck();
  const directory = useCompanyDirectory();
  const liveGroups = useStoryGroups();

  /*
   * Snapshotted once, in the initialiser.
   *
   * `useStoryGroups` re-sorts as stories are marked watched — unwatched rings float to the
   * front — so reading it live would reorder the deck underneath somebody midway through
   * it. Home used to take this snapshot into its own state for exactly this reason; the
   * initialiser runs on the first render only, which keeps that guarantee.
   */
  const [groups] = useState(liveGroups);

  const startGroupIndex = Math.max(
    0,
    groups.findIndex((group) => group.id === params.group),
  );
  const startItemIndex = Number.parseInt(params.item ?? '0', 10) || 0;

  // The ring was tapped before the news feed resolved, so there is nothing to play.
  if (groups.length === 0) return null;

  return (
    <StoryViewer
      groups={groups}
      startGroupIndex={startGroupIndex}
      startItemIndex={startItemIndex}
      companyBySlug={directory.bySlug}
      onClose={() => router.back()}
      onSeen={markNewsSeen}
      onToggleFollow={toggleFollow}
    />
  );
}
