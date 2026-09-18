import { FlatList } from 'react-native';

import { ResumeBubble } from '@/components/profile/ResumeBubble';
import { spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';
import type { Resume } from '@/types';

interface ResumeShelfProps {
  resumes: Resume[];
  defaultResumeId: string;
  onView: (resumeId: string) => void;
}

/**
 * The stored resumes as a row of page-1 thumbnails. Lives inside Profile's expandable
 * "Resumes" row, so it carries no heading of its own — the row above it is the heading.
 */
export function ResumeShelf({ resumes, defaultResumeId, onView }: ResumeShelfProps) {
  const styles = useStyles();

  return (
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
  );
}

const useStyles = makeStyles(() => ({
  // The horizontal padding here is what re-aligns the first bubble with the row label
  // above it, after RowGroup pulls this content out to the card's edges.
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
}));
