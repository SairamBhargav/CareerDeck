import { View } from 'react-native';

import { Skeleton } from '@/components/common/Skeleton';
import { JobFeedCard } from '@/components/home/JobFeedCard';
import { spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';
import type { Company, Job } from '@/types';

/** How many of the newest postings show on Home — Reels is the full feed, this is a taste. */
const VISIBLE_COUNT = 6;
const SKELETON_ROWS = 3;

interface HomeJobFeedProps {
  jobs: Job[];
  companyById: Map<string, Company>;
  loading: boolean;
  onPressJob: (job: Job) => void;
  onToggleSave: (jobId: string) => void;
}

/**
 * Home's vertical "Your Feed" — the newest postings as a plain scannable list, the one
 * concession Home makes to actually being a jobs app rather than a dashboard of
 * carousels. Not virtualized: it's a bounded slice inside a screen that already scrolls
 * vertically, so a nested FlatList would just fight the outer ScrollView.
 */
export function HomeJobFeed({ jobs, companyById, loading, onPressJob, onToggleSave }: HomeJobFeedProps) {
  const styles = useStyles();

  if (loading) {
    return (
      <View style={styles.list}>
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <Skeleton key={index} height={132} borderRadius={18} />
        ))}
      </View>
    );
  }

  const visible = jobs.slice(0, VISIBLE_COUNT);

  return (
    <View style={styles.list}>
      {visible.map((job) => (
        <JobFeedCard
          key={job.id}
          job={job}
          logoColor={companyById.get(job.companyId)?.logoColor}
          logoUrl={companyById.get(job.companyId)?.logo}
          onPress={() => onPressJob(job)}
          onToggleSave={() => onToggleSave(job.id)}
        />
      ))}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  list: {
    gap: spacing.md,
  },
}));
