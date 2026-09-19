import { View } from 'react-native';

import { Skeleton } from '@/components/common/Skeleton';
import { JobFeedCard } from '@/components/home/JobFeedCard';
import { spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';
import type { Company, Job } from '@/types';

const SKELETON_ROWS = 3;

interface HomeJobFeedProps {
  jobs: Job[];
  companyById: Map<string, Company>;
  loading: boolean;
  onPressJob: (job: Job) => void;
  onToggleSave: (jobId: string) => void;
}

/**
 * Home's vertical "Your Feed" — every posting, newest first, as a plain scannable list.
 * The one concession Home makes to actually being a jobs app rather than a dashboard of
 * carousels, so it runs to the end of the feed rather than stopping at a teaser.
 *
 * Not virtualized: it lives inside a screen that already scrolls vertically, so a nested
 * FlatList would just fight the outer ScrollView. That's fine at the current fixture
 * size but is the thing to revisit when the job list stops being a local constant.
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

  return (
    <View style={styles.list}>
      {jobs.map((job) => (
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
