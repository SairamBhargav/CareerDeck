import { FlatList, View } from 'react-native';

import { SectionHeader } from '@/components/common/SectionHeader';
import { Skeleton } from '@/components/common/Skeleton';
import { RESUME_BUBBLE_WIDTH, ResumeBubble } from '@/components/home/ResumeBubble';
import { screenPadding, spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';
import type { Resume } from '@/types';

const SKELETON_COUNT = 3;

interface ResumeCarouselProps {
  resumes: Resume[];
  defaultResumeId: string;
  loading: boolean;
  onView: (resumeId: string) => void;
  onSeeAll: () => void;
}

export function ResumeCarousel({ resumes, defaultResumeId, loading, onView, onSeeAll }: ResumeCarouselProps) {
  const styles = useStyles();

  return (
    <View>
      <View style={styles.header}>
        <SectionHeader title="Your Resumes" actionLabel="Manage" onActionPress={onSeeAll} />
      </View>

      {loading ? (
        <View style={styles.skeletonRow}>
          {Array.from({ length: SKELETON_COUNT }, (_, index) => (
            <Skeleton key={index} width={RESUME_BUBBLE_WIDTH} height={208} borderRadius={26} />
          ))}
        </View>
      ) : (
        <FlatList
          horizontal
          data={resumes}
          keyExtractor={(resume) => resume.id}
          showsHorizontalScrollIndicator={false}
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
  header: {
    paddingHorizontal: screenPadding,
  },
  list: {
    paddingHorizontal: screenPadding,
    gap: spacing.md,
  },
  skeletonRow: {
    flexDirection: 'row',
    paddingHorizontal: screenPadding,
    gap: spacing.md,
  },
}));
