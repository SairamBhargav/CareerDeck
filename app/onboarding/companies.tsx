import * as Haptics from 'expo-haptics';
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { CompanyLogo } from '@/components/common/CompanyLogo';
import { ScrollPane } from '@/components/common/ScrollPane';
import { OnboardingStep } from '@/components/onboarding/OnboardingStep';
import { PER_FIELD, companiesForSectors } from '@/constants/industries';
import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';
import { useGuardedRouter } from '@/hooks/useGuardedRouter';
import { useOnboarding } from '@/context/OnboardingContext';
import { useCompanyDirectory } from '@/hooks/useCompanies';
import type { Company } from '@/types';

/**
 * The ceiling, however many fields somebody picks.
 *
 * The list is PER_FIELD per pick — fifteen each, alternating — which is right up to a
 * handful of fields and absurd at twenty. Somebody who taps half the grid is telling
 * you they are undecided, not asking for seven hundred rows, and past about sixty the
 * list stops being a shortlist and becomes the directory.
 */
const MAX_SUGGESTIONS = 60;

/**
 * The floor below which the step borrows from outside the picked fields.
 *
 * Six fields map to no company on the board list at all — Pharmaceuticals, Agriculture,
 * Real Estate and a few others — and somebody who picks only those would otherwise see
 * an empty screen, which reads as the app being broken rather than the corpus being
 * young. Five rows is enough to look deliberate and few enough that nobody mistakes
 * them for a match.
 */
const MIN_SUGGESTIONS = 5;

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
  const router = useGuardedRouter();
  const styles = useStyles();
  const { industries, followedCompanySlugs, toggleCompany } = useOnboarding();
  const directory = useCompanyDirectory();

  const suggestions = useMemo(() => {
    // Fifteen per field they picked, so two picks give thirty and one gives fifteen.
    const limit = Math.min(PER_FIELD * Math.max(industries.length, 1), MAX_SUGGESTIONS);

    /*
     * Every company in the fields they picked, best first, capped at limit.
     *
     * `companiesForSectors` interleaves rather than concatenates, so somebody who picked
     * Artificial Intelligence and Accounting sees a spend-management company before the
     * eleventh AI lab. Within each field the order is the curated one in
     * constants/industries.ts, which runs roughly most-recognisable first — so the
     * interleave already produces a sensible "top N" without a second ranking pass.
     *
     * Companies with nothing open are kept. A student following an employer they want to
     * work for is a real signal even in a quiet month, and the corpus moves nightly:
     * the 2026-09-29 scope rules alone took it from 30,800 postings to 13,650, which
     * would have emptied out plenty of companies that will list again next week.
     */
    const wanted = companiesForSectors(industries)
      .map((slug) => directory.bySlug.get(slug))
      .filter((company): company is Company => company !== undefined);

    /*
     * Backfill is a floor, not a filler.
     *
     * It used to top the list up to `limit` whenever the picks fell short, which meant a
     * pick like Banking — nine companies against a limit of fifteen — got six rows chosen
     * purely by who had the most open roles. That is how somebody who tapped Banking was
     * offered OpenAI, and it makes the step look like it did not listen.
     *
     * The only case that genuinely needs rescuing is a pick the board list cannot answer
     * at all: Pharmaceuticals, Agriculture and Real Estate map to nothing today, and an
     * empty third step reads as a broken app. So it fires only below MIN_SUGGESTIONS, and
     * only fills to there — never up to the full list. A short, honest list beats a long
     * one padded with strangers.
     */
    if (wanted.length < MIN_SUGGESTIONS) {
      const taken = new Set(wanted.map((company) => company.slug));
      const rest = directory.companies
        .filter((company) => !taken.has(company.slug))
        .sort((a, b) => b.openJobCount - a.openJobCount);

      for (const company of rest) {
        if (wanted.length >= MIN_SUGGESTIONS) break;
        wanted.push(company);
      }
    }

    return wanted.slice(0, limit);
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
      fills>
      {directory.isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator />
        </View>
      ) : (
        <ScrollPane
          data={suggestions}
          keyExtractor={(company) => company.id}
          renderItem={(company) => {
            const following = followedCompanySlugs.includes(company.slug);
            return (
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  toggleCompany(company.slug);
                }}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: following }}
                accessibilityLabel={`${following ? 'Unfollow' : 'Follow'} ${company.name}`}
                style={styles.row}>
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
          }}
        />
      )}
    </OnboardingStep>
  );
}

const useStyles = makeStyles((colors) => ({
  loading: {
    paddingVertical: spacing.xxl * 2,
    alignItems: 'center',
  },
  // The row carries its own spacing now: a virtualised list has no wrapper to put a
  // `gap` on, and the last row's margin is absorbed by the pane's bottom inset.
  
  row: {
    marginBottom: spacing.sm + 2,
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
}));
