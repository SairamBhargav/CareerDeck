import { FlatList, View } from 'react-native';

import { SectionHeader } from '@/components/common/SectionHeader';
import { Skeleton } from '@/components/common/Skeleton';
import { CompanySuggestionCard, SUGGESTION_CARD_WIDTH } from '@/components/home/CompanySuggestionCard';
import { screenPadding, spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';
import type { Company } from '@/types';

const SKELETON_COUNT = 3;

interface SuggestedCompaniesProps {
  companies: Company[];
  loading: boolean;
  onToggleFollow: (companyId: string) => void;
  onSeeAll: () => void;
}

export function SuggestedCompanies({ companies, loading, onToggleFollow, onSeeAll }: SuggestedCompaniesProps) {
  const styles = useStyles();

  return (
    <View>
      <View style={styles.header}>
        <SectionHeader title="Suggested for you" actionLabel="See all" onActionPress={onSeeAll} />
      </View>

      {loading ? (
        <View style={styles.skeletonRow}>
          {Array.from({ length: SKELETON_COUNT }, (_, index) => (
            <Skeleton key={index} width={SUGGESTION_CARD_WIDTH} height={148} borderRadius={18} />
          ))}
        </View>
      ) : (
        <FlatList
          horizontal
          data={companies}
          keyExtractor={(company) => company.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <CompanySuggestionCard company={item} onToggleFollow={() => onToggleFollow(item.id)} />
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
