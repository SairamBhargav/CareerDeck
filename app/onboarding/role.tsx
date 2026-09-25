import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Pressable, Text, View } from 'react-native';

import { OnboardingStep } from '@/components/onboarding/OnboardingStep';
import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';
import { ROLE_OPTIONS, useOnboarding, type RoleKey } from '@/context/OnboardingContext';

/**
 * Step one: who you are and what you want, in one tap.
 *
 * Deliberately one question rather than two. The stage someone is at and the thing they
 * are looking for are the same fact for this audience — a sophomore wants an internship,
 * a senior wants a new-grad role — and asking twice costs a screen to learn nothing.
 *
 * The answer is load-bearing downstream: it seeds `preferred_employment_types`, tells the
 * ranker which seniorities to lead with, and decides whether sign-up asks for a school
 * and graduation year at all.
 *
 * Selection is the fill, with nothing added inside the row. A checkmark here would be the
 * second thing saying what the fill already says, and it is the same choice step two
 * makes — the steps have to agree on what "picked" looks like or the sequence stops
 * reading as one.
 */
export default function RoleStep() {
  const router = useRouter();
  const styles = useStyles();
  const { role, setRole } = useOnboarding();

  const choose = (key: RoleKey) => {
    Haptics.selectionAsync();
    setRole(key);
  };

  return (
    <OnboardingStep
      step={1}
      title={'Which sounds\nlike you?'}
      subtitle="It sets what your feed leads with. You can change it later."
      canContinue={role !== null}
      onContinue={() => router.push('/onboarding/industries')}>
      <View style={styles.list}>
        {ROLE_OPTIONS.map((option) => {
          const selected = role === option.key;
          return (
            <Pressable
              key={option.key}
              onPress={() => choose(option.key)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={option.label}
              style={({ pressed }) => [
                styles.row,
                selected ? styles.rowSelected : null,
                pressed ? styles.pressed : null,
              ]}>
              <Text style={[styles.label, selected ? styles.labelSelected : null]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </OnboardingStep>
  );
}

const useStyles = makeStyles((colors) => ({
  list: {
    gap: spacing.md,
  },
  row: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg + 2,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowSelected: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  label: {
    flex: 1,
    fontSize: fontSize.body,
    fontWeight: '600',
    lineHeight: 20,
    color: colors.text,
  },
  labelSelected: {
    color: colors.accentText,
  },
  pressed: {
    opacity: 0.75,
  },
}));
