import { FlatList, View } from 'react-native';

import { SectionHeader } from '@/components/common/SectionHeader';
import { Skeleton } from '@/components/common/Skeleton';
import { RESUME_BUBBLE_WIDTH, ResumeBubble } from '@/components/activity/ResumeBubble';
import { radius, screenPadding, spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';
import type { Resume } from '@/types';

const SKELETON_COUNT = 3;
const BUBBLE_HEIGHT = 208;

interface ResumeShelfProps {
  resumes: Resume[];
  defaultResumeId: string;
  loading: boolean;
  onView: (resumeId: string) => void;
}

/**
 * The stored resumes as a row of page-1 thumbnails, at the top of Activity — they're
 * part of the record of what the user has built, which is what this tab is for, rather
 * than something to scroll past on the way to a feed.
 *
 * Activity pads its whole scroll view, so the list breaks back out to the screen edge
 * itself: a carousel that stops short of the edge reads as clipped rather than as
 * having more to the right.
 */
export function ResumeShelf({ resumes, defaultResumeId, loading, onView }: ResumeShelfProps) {
  const styles = useStyles();

  return (
    <View>
      <SectionHeader title="Your Resumes" />

      {loading ? (
        <View style={styles.skeletonRow}>
          {Array.from({ length: SKELETON_COUNT }, (_, index) => (
            <Skeleton
              key={index}
              width={RESUME_BUBBLE_WIDTH}
              height={BUBBLE_HEIGHT}
              borderRadius={radius.xl}
            />
          ))}
        </View>
      ) : (
        <FlatList
          horizontal
          data={resumes}
          keyExtractor={(resume) => resume.id}
          showsHorizontalScrollIndicator={false}
          style={styles.bleed}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <ResumeBubble
              resume={item}
              isDefault={item.id === defaultResumeId}
              onPress={() => onView(item.id)}
            />
          )}
        />
      )}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  // Cancels Activity's screen padding so bubbles can run off both edges, then the
  // content inset below puts the first one back in line with the heading.
  bleed: {
    marginHorizontal: -screenPadding,
  },
  list: {
    paddingHorizontal: screenPadding,
    gap: spacing.md,
  },
  skeletonRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
}));
