import * as Haptics from 'expo-haptics';
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { CompanyLogo } from '@/components/common/CompanyLogo';
import { FollowButton } from '@/components/common/FollowButton';
import { ScrollPane } from '@/components/common/ScrollPane';
import { OnboardingStep } from '@/components/onboarding/OnboardingStep';
import { PER_FIELD, companiesForSectors } from '@/constants/industries';
import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';
import { useGuardedRouter } from '@/hooks/useGuardedRouter';
import { useOnboarding } from '@/context/OnboardingContext';
import { useCompanyDirectory } from '@/hooks/useCompanies';
import type { Company } from '@/types';
import { companyAudience } from '@/utils/format';

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

/** How many follows the step asks for before Continue unlocks. Kept below MIN_SUGGESTIONS. */
const MIN_FOLLOWS = 3;

/** Per-row stagger, capped so a long list's tail isn't left waiting. Matches the Following list. */
const STAGGER_MS = 45;
const MAX_STAGGER_INDEX = 7;

/**
 * Step four: follow a few companies.
 *
 * Three is the floor, and there is no skip. A user who follows nothing gets an empty
 * Following tab on their first launch, which is the tab most likely to be opened second;
 * three is enough for it to have something new most days. The list is never shorter
 * than MIN_SUGGESTIONS, so the floor can always be met.
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
      step={4}
      title={'Follow a few\nto start.'}
      subtitle={`Pick at least ${MIN_FOLLOWS}. Their new roles land at the top of your Deck.`}
      canContinue={count >= MIN_FOLLOWS}
      continueLabel={count >= MIN_FOLLOWS ? `Continue with ${count}` : `Follow ${MIN_FOLLOWS - count} more`}
      onContinue={() => router.push('/sign-up')}
      fills>
      {directory.isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator />
        </View>
      ) : (
        <ScrollPane
          data={suggestions}
          keyExtractor={(company) => company.id}
          renderItem={(company, index) => {
            const following = followedCompanySlugs.includes(company.slug);
            const toggle = () => toggleCompany(company.slug);
            return (
              <Animated.View
                entering={FadeInDown.duration(260).delay(Math.min(index, MAX_STAGGER_INDEX) * STAGGER_MS)}>
                {/* The same row as the Following list in the app, so the first companies
                    somebody follows look exactly like where they will find them again. The
                    row toggles too: here there is no company page to open, and a whole row
                    is an easier target than the button. */}
                <Pressable
                  onPress={() => {
                    Haptics.selectionAsync();
                    toggle();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${following ? 'Unfollow' : 'Follow'} ${company.name}`}
                  style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}>
                  <CompanyLogo
                    logo={company.logo}
                    name={company.name}
                    color={company.logoColor}
                    size="md"
                  />

                  <View style={styles.text}>
                    <Text style={styles.name} numberOfLines={1}>
                      {company.name}
                    </Text>
                    <Text style={styles.meta} numberOfLines={1}>
                      {companyAudience(company)}
                    </Text>
                  </View>

                  <FollowButton
                    isFollowing={following}
                    companyName={company.name}
                    onToggle={toggle}
                    size="sm"
                  />
                </Pressable>
              </Animated.View>
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
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  // A background change rather than opacity, as in the Following list: a logo that dims
  // reads as an image failing to load.
  pressed: {
    backgroundColor: colors.backgroundMuted,
  },
  text: {
    flex: 1,
    gap: 1,
  },
  name: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.text,
    letterSpacing: -0.2,
  },
  meta: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
  },
}));
