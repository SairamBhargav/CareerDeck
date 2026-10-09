import { FlatList, StyleSheet, View } from 'react-native';

import { SectionHeader } from '@/components/common/SectionHeader';
import { Skeleton } from '@/components/common/Skeleton';
import { CompanySuggestionCard, SUGGESTION_CARD_WIDTH } from '@/components/home/CompanySuggestionCard';
import { radius, screenPadding, spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';
import type { Company } from '@/types';

const SKELETON_COUNT = 3;

interface SuggestedCompaniesProps {
  companies: Company[];
  loading: boolean;
  onPressCompany: (company: Company) => void;
  /** Takes the company **slug** — `toggleFollow` keys on the slug, not the uuid. */
  onToggleFollow: (companySlug: string) => void;
  /** Also by slug, for the same reason. */
  onDismiss: (companySlug: string) => void;
  onSeeAll: () => void;
}

export function SuggestedCompanies({
  companies,
  loading,
  onPressCompany,
  onToggleFollow,
  onDismiss,
  onSeeAll,
}: SuggestedCompaniesProps) {
  const styles = useStyles();

  /*
   * The whole section goes, heading included.
   *
   * Ten are shown out of a pool of thirty, so dismissing twenty-one empties the row — and
   * `suggested_companies()` caps its limit at fifty, so there is no deeper reserve to reach
   * for. Nobody is likely to get there, but "Suggested for you" above an empty strip reads
   * as a failed load rather than a row someone emptied on purpose.
   */
  if (!loading && companies.length === 0) return null;

  return (
    <View>
      <View style={styles.header}>
        <SectionHeader title="Suggested for you" actionLabel="See all" onActionPress={onSeeAll} />
      </View>

      {loading ? (
        <View style={styles.skeletonRow}>
          {/* The suggestion card's own anatomy — mark, name, follower line, follow control
              — rather than a blank plate of the right height. The feed below loads the
              same way, and a detailed skeleton sitting under a featureless one looks like
              one of them is broken. */}
          {Array.from({ length: SKELETON_COUNT }, (_, index) => (
            <View key={index} style={styles.skeletonCard}>
              <Skeleton width={48} height={48} borderRadius={radius.lg} />
              <Skeleton width={76} height={12} />
              <Skeleton width={52} height={10} />
              <Skeleton width={64} height={14} />
            </View>
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
            <CompanySuggestionCard
              company={item}
              onPress={() => onPressCompany(item)}
              onToggleFollow={() => onToggleFollow(item.slug)}
              onDismiss={() => onDismiss(item.slug)}
            />
          )}
        />
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
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
  // Mirrors CompanySuggestionCard, so the row does not resize when the real ones arrive.
  skeletonCard: {
    width: SUGGESTION_CARD_WIDTH,
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
}));
