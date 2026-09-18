import { Fragment, useMemo } from 'react';
import { View } from 'react-native';

import { Skeleton } from '@/components/common/Skeleton';
import { JobFeedCard } from '@/components/home/JobFeedCard';
import { SuggestedCompanies } from '@/components/home/SuggestedCompanies';
import { screenPadding, spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';
import type { Company, Job } from '@/types';

/** Postings before the first suggested-companies rail — early, while attention is high. */
const FIRST_SUGGESTION_AFTER = 15;
/** Every rail after that sits a fresh random distance further on, inclusive of both ends. */
const MIN_SUGGESTION_GAP = 25;
const MAX_SUGGESTION_GAP = 35;
const SKELETON_ROWS = 3;

/**
 * The card positions a rail follows. The first is fixed; each one after it is rolled
 * fresh in the 25-35 range, so the feed never falls into a visible rhythm the way a
 * fixed interval does.
 *
 * Stopping short of `total` is what keeps a rail from ever being the final block — as
 * the last thing on the page it reads as the feed having run out of jobs rather than as
 * a break in them.
 */
function buildRailPositions(total: number): Set<number> {
  const spread = MAX_SUGGESTION_GAP - MIN_SUGGESTION_GAP + 1;
  const positions = new Set<number>();

  for (let position = FIRST_SUGGESTION_AFTER; position < total; ) {
    positions.add(position);
    position += MIN_SUGGESTION_GAP + Math.floor(Math.random() * spread);
  }

  return positions;
}

interface HomeJobFeedProps {
  jobs: Job[];
  companyById: Map<string, Company>;
  suggestedCompanies: Company[];
  loading: boolean;
  onPressJob: (job: Job) => void;
  onToggleSave: (jobId: string) => void;
  onToggleFollow: (companyId: string) => void;
  onSeeAllCompanies: () => void;
}

/**
 * Home's vertical "Your Feed" — the newest postings as a plain scannable list, the one
 * concession Home makes to actually being a jobs app rather than a dashboard of
 * carousels. The suggested-companies rail cuts in at intervals along the way, so
 * following someone is something you stumble into mid-scroll rather than a block you
 * pass once at the top and never see again.
 *
 * Not virtualized: it lives inside a screen that already scrolls vertically, so a nested
 * FlatList would just fight the outer ScrollView. That's fine at the current feed size
 * but is the thing to revisit when the job list stops being a fixed local fixture.
 */
export function HomeJobFeed({
  jobs,
  companyById,
  suggestedCompanies,
  loading,
  onPressJob,
  onToggleSave,
  onToggleFollow,
  onSeeAllCompanies,
}: HomeJobFeedProps) {
  const styles = useStyles();

  // Rolled once per feed length rather than per render: without the memo every save,
  // like or follow would re-roll the gaps and visibly shuffle the rails mid-scroll.
  const railPositions = useMemo(() => buildRailPositions(jobs.length), [jobs.length]);

  if (loading) {
    return (
      <View style={[styles.list, styles.padded]}>
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <Skeleton key={index} height={132} borderRadius={18} />
        ))}
      </View>
    );
  }

  return (
    <View style={styles.list}>
      {jobs.map((job, index) => {
        const position = index + 1;
        const showRail = railPositions.has(position) && suggestedCompanies.length > 0;

        return (
          <Fragment key={job.id}>
            <View style={styles.padded}>
              <JobFeedCard
                job={job}
                logoColor={companyById.get(job.companyId)?.logoColor}
                logoUrl={companyById.get(job.companyId)?.logo}
                onPress={() => onPressJob(job)}
                onToggleSave={() => onToggleSave(job.id)}
              />
            </View>

            {showRail ? (
              <View style={styles.rail}>
                <SuggestedCompanies
                  companies={leadWith(suggestedCompanies, position)}
                  loading={false}
                  onToggleFollow={onToggleFollow}
                  onSeeAll={onSeeAllCompanies}
                />
              </View>
            ) : null}
          </Fragment>
        );
      })}
    </View>
  );
}

/**
 * Rotates the rail so each appearance leads with a different company. The same ten are
 * always reachable by scrolling sideways — this just stops the second rail looking like
 * the first one pasted in again.
 */
function leadWith(companies: Company[], offset: number): Company[] {
  if (companies.length === 0) return companies;
  const start = offset % companies.length;
  return [...companies.slice(start), ...companies.slice(0, start)];
}

const useStyles = makeStyles(() => ({
  list: {
    gap: spacing.md,
  },
  // Applied per row rather than to the whole list, so the rail inside it can still run
  // its cards off the edge of the screen the way a carousel should.
  padded: {
    paddingHorizontal: screenPadding,
  },
  rail: {
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
}));
