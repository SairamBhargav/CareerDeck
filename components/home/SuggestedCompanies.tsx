import { FlatList, StyleSheet, View } from 'react-native';

import { SectionHeader } from '@/components/common/SectionHeader';
import { CompanySuggestionCard } from '@/components/home/CompanySuggestionCard';
import { screenPadding, spacing } from '@/constants/theme';
import type { Company } from '@/types';

interface SuggestedCompaniesProps {
  companies: Company[];
  onToggleFollow: (companyId: string) => void;
  onSeeAll: () => void;
}

export function SuggestedCompanies({ companies, onToggleFollow, onSeeAll }: SuggestedCompaniesProps) {
  return (
    <View>
      <View style={styles.header}>
        <SectionHeader title="Suggested for you" actionLabel="See all" onActionPress={onSeeAll} />
      </View>

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
