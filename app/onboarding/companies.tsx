import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { CompanyLogo } from '@/components/common/CompanyLogo';
import { OnboardingStep } from '@/components/onboarding/OnboardingStep';
import { companiesForSectors } from '@/constants/industries';
import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';
import { useOnboarding } from '@/context/OnboardingContext';
import { useCompanyDirectory } from '@/hooks/useCompanies';
import type { Company } from '@/types';

/** Enough to make a Following feed worth opening, few enough to fit without scrolling far. */
const SUGGESTION_LIMIT = 12;

/**
 * Step three: follow a few companies.
 *
 * The only genuinely skippable step, and the most valuable one that isn't required. A
 * user who follows nothing gets an empty Following tab on their first launch, which is
 * the tab most likely to be opened second.
 *
 * Suggestions come from the sectors picked on step two, interleaved rather than
 * concatenated so a smaller pick is not buried under a larger one — see
 * `companiesForSectors`. Companies are read from the real directory, which works
 * signed-out: `companies` is world-readable (phase 1 §2.10).
 */
export default function CompaniesStep() {
  const router = useRouter();
  const styles = useStyles();
  const { industries, followedCompanySlugs, toggleCompany } = useOnboarding();
  const directory = useCompanyDirectory();

  const suggestions = useMemo(() => {
    const wanted = companiesForSectors(industries);
    const resolved = wanted
      .map((slug) => directory.bySlug.get(slug))
      .filter((company): company is Company => company !== undefined);

    // A sector whose companies have not been crawled yet would leave this short, so the
    // rest of the directory backfills it rather than showing four rows and a gap.
    if (resolved.length < SUGGESTION_LIMIT) {
      for (const company of directory.companies) {
        if (resolved.length >= SUGGESTION_LIMIT) break;
        if (!resolved.some((entry) => entry.slug === company.slug)) resolved.push(company);
      }
    }

    return resolved.slice(0, SUGGESTION_LIMIT);
  }, [industries, directory]);

  const count = followedCompanySlugs.length;

  return (
    <OnboardingStep
      step={3}
      title={'Follow a few\nto start.'}
      subtitle="Their new roles land at the top of your Deck."
      canContinue
      continueLabel={count > 0 ? `Continue with ${count}` : 'Continue'}
      onContinue={() => router.push('/sign-up')}
      onSkip={() => router.push('/sign-up')}
      scrolls>
      {directory.isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator />
        </View>
      ) : (
        <View style={styles.list}>
          {suggestions.map((company) => {
            const following = followedCompanySlugs.includes(company.slug);
            return (
              <Pressable
                key={company.id}
                onPress={() => {
                  Haptics.selectionAsync();
                  toggleCompany(company.slug);
                }}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: following }}
                accessibilityLabel={`${following ? 'Unfollow' : 'Follow'} ${company.name}`}
                style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}>
                <CompanyLogo
                  logo={company.logo}
                  name={company.name}
                  color={company.logoColor}
                  size="sm"
                />

                <View style={styles.text}>
                  <Text style={styles.name} numberOfLines={1}>
                    {company.name}
                  </Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {company.industry}
                    {company.openJobCount > 0 ? ` · ${company.openJobCount} open` : ''}
                  </Text>
                </View>

                <View style={[styles.pill, following ? styles.pillOn : null]}>
                  <Text style={[styles.pillLabel, following ? styles.pillLabelOn : null]}>
                    {following ? 'Following' : 'Follow'}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </OnboardingStep>
  );
}

const useStyles = makeStyles((colors) => ({
  loading: {
    paddingVertical: spacing.xxl * 2,
    alignItems: 'center',
  },
  list: {
    gap: spacing.sm + 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md + 2,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.text,
  },
  meta: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
  },
  pill: {
    paddingVertical: spacing.sm + 1,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.background,
  },
  pillOn: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  pillLabel: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.text,
  },
  pillLabelOn: {
    color: colors.accentText,
  },
  pressed: {
    opacity: 0.75,
  },
}));
