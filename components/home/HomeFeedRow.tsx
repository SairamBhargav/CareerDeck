import { memo } from 'react';

import { JobFeedCard } from '@/components/home/JobFeedCard';
import { SwipeableJobRow } from '@/components/home/SwipeableJobRow';
import type { Job } from '@/types';

interface HomeFeedRowProps {
  job: Job;
  /*
   * Every handler takes the job rather than closing over it, which is the whole point of
   * this component existing. A closure built in `renderItem` is a new value on every
   * render of the screen, so `memo` would never hold and each row would rebuild — and a
   * row rebuilding here is not cheap: SwipeableJobRow carries four shared values, four
   * animated styles and a pan gesture, and there are ten to twenty of them mounted.
   */
  onPress: (job: Job) => void;
  onToggleLike: (jobId: string) => void;
  onCompanyPress: (companySlug: string) => void;
  onHide: (job: Job) => void;
  onLike: (job: Job) => void;
}

/**
 * One row of Home's feed, memoized.
 *
 * Home reads the whole CareerDeck context, so a like, a follow, a credit change or an
 * arriving notification re-renders the screen. Without this, each of those re-rendered
 * every mounted row, which meant tearing down and rebuilding every gesture handler on the
 * list — work that lands on the same thread that has to notice the next tap.
 */
function HomeFeedRowComponent({
  job,
  onPress,
  onToggleLike,
  onCompanyPress,
  onHide,
  onLike,
}: HomeFeedRowProps) {
  return (
    <SwipeableJobRow onHide={() => onHide(job)} onLike={() => onLike(job)}>
      <JobFeedCard
        job={job}
        logoColor={job.companyLogoColor ?? undefined}
        logoUrl={job.companyLogoUrl ?? undefined}
        onPress={() => onPress(job)}
        onToggleLike={() => onToggleLike(job.id)}
        onCompanyPress={() => onCompanyPress(job.companySlug)}
      />
    </SwipeableJobRow>
  );
}

/*
 * Compared on the fields the row actually draws, not by reference.
 *
 * `useFeedItems` rebuilds its Job objects whenever the viewer's like set changes, so every
 * job is a new object even when nothing about it moved. A default shallow compare would
 * see that and re-render the lot, which is the case this exists to stop.
 */
export const HomeFeedRow = memo(HomeFeedRowComponent, (before, after) => {
  const a = before.job;
  const b = after.job;
  return (
    a.id === b.id &&
    a.isLiked === b.isLiked &&
    a.title === b.title &&
    a.companyName === b.companyName &&
    a.companyLogoUrl === b.companyLogoUrl &&
    a.companyLogoColor === b.companyLogoColor &&
    before.onPress === after.onPress &&
    before.onToggleLike === after.onToggleLike &&
    before.onCompanyPress === after.onCompanyPress &&
    before.onHide === after.onHide &&
    before.onLike === after.onLike
  );
});
