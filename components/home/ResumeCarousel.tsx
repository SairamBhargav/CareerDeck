import { FlatList, StyleSheet, View } from 'react-native';

import { SectionHeader } from '@/components/common/SectionHeader';
import { ResumeBubble } from '@/components/home/ResumeBubble';
import { screenPadding, spacing } from '@/constants/theme';
import type { Resume } from '@/types';

interface ResumeCarouselProps {
  resumes: Resume[];
  defaultResumeId: string;
  onSelect: (resumeId: string) => void;
  onSeeAll: () => void;
}

export function ResumeCarousel({ resumes, defaultResumeId, onSelect, onSeeAll }: ResumeCarouselProps) {
  return (
    <View>
      <View style={styles.header}>
        <SectionHeader title="Your Resumes" actionLabel="Manage" onActionPress={onSeeAll} />
      </View>

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
            onPress={() => onSelect(item.id)}
          />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: screenPadding,
  },
  list: {
    paddingHorizontal: screenPadding,
    gap: spacing.md,
  },
});
