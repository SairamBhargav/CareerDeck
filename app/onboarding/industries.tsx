import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Pressable, Text, View } from 'react-native';

import { OnboardingStep } from '@/components/onboarding/OnboardingStep';
import { MIN_SECTORS, SECTORS } from '@/constants/industries';
import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useOnboarding } from '@/context/OnboardingContext';

/**
 * Step two: the sectors that fill the feed.
 *
 * The chips are the nine curated sectors in constants/industries.ts, not the corpus's own
 * `companies.industry` values — that file explains why at length. The short version: the
 * data's labels are what each company calls itself ("Model Inference", "Corporate Spend"),
 * which is unanswerable as a question, and two of the obvious groupings were too thin to
 * offer without promising a feed that would come back nearly empty.
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
      onContinue={() => router.push('/onboarding/companies')}
      scrolls>
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

      <Text style={styles.hint}>
        {picked === 0
          ? 'Pick at least one. Adding more widens the feed — it never narrows it to nothing.'
          : `${picked} picked. Adding more widens the feed — it never narrows it to nothing.`}
      </Text>
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
  hint: {
    marginTop: spacing.lg,
    fontSize: fontSize.small,
    lineHeight: 19,
    color: colors.textTertiary,
  },
  pressed: {
    opacity: 0.75,
  },
}));
