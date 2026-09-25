import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Pressable, Text, View } from 'react-native';

import { ScrollPane } from '@/components/common/ScrollPane';
import { OnboardingStep } from '@/components/onboarding/OnboardingStep';
import { MIN_SECTORS, SECTORS } from '@/constants/industries';
import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useOnboarding } from '@/context/OnboardingContext';

/**
 * Step two: the sectors that fill the feed.
 *
 * The chips are the curated sectors in constants/industries.ts, not the corpus's own
 * `companies.industry` values — that file explains why at length. The short version: the
 * data's labels are what each company calls itself ("Model Inference", "Corporate Spend"),
 * which is unanswerable as a question.
 *
 * There are enough of them now to overflow, which is deliberate: someone whose field is
 * not in the first screenful will not invent it, they will pick something close and get a
 * worse feed. They scroll inside a ScrollPane rather than making the page taller, so the
 * headline and the button stay put and the screen keeps the proportions it had at nine
 * chips. The rail in the right gutter is what says there is more, before anyone has to
 * guess.
 *
 * No helper line under the chips. The button carries the count, which says the same thing
 * in the place the eye is already going.
 */
export default function IndustriesStep() {
  const router = useRouter();
  const styles = useStyles();
  const { colors } = useTheme();
  const { industries, toggleIndustry } = useOnboarding();

  const picked = industries.length;

  return (
    <OnboardingStep
      step={2}
      title={'Pick what fills\nyour feed.'}
      subtitle="It learns from every scroll after that."
      canContinue={picked >= MIN_SECTORS}
      continueLabel={picked > 0 ? `Continue with ${picked}` : 'Continue'}
      onContinue={() => router.push('/onboarding/companies')}
      fills>
      <ScrollPane>
        <View style={styles.chips}>
          {SECTORS.map((sector) => {
            const selected = industries.includes(sector.key);
            return (
              <Pressable
                key={sector.key}
                onPress={() => {
                  Haptics.selectionAsync();
                  toggleIndustry(sector.key);
                }}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={sector.label}
                style={({ pressed }) => [
                  styles.chip,
                  selected ? styles.chipSelected : null,
                  pressed ? styles.pressed : null,
                ]}>
                {selected ? (
                  <Ionicons name="checkmark" size={14} color={colors.accentText} />
                ) : null}
                <Text style={[styles.chipLabel, selected ? styles.chipLabelSelected : null]}>
                  {sector.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollPane>
    </OnboardingStep>
  );
}

const useStyles = makeStyles((colors) => ({
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm + 2,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 46,
    paddingVertical: spacing.md + 1,
    paddingHorizontal: spacing.lg + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  chipLabel: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.text,
  },
  chipLabelSelected: {
    color: colors.accentText,
  },
  pressed: {
    opacity: 0.75,
  },
}));
