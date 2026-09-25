import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/common/PrimaryButton';
import { fontSize, screenPadding, spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';

/**
 * The frame every onboarding step sits in: step count, headline, one line of subtext,
 * the content, and a button pinned to the bottom.
 *
 * It exists so the three steps cannot drift apart. They are the highest-stakes screens
 * in the app for conversion and they have to read as one sequence — a headline two points
 * larger on step two is the kind of thing nobody can name but everybody feels.
 */

export const TOTAL_STEPS = 3;

interface OnboardingStepProps {
  step: number;
  /** Two lines, usually. Kept as one string with an explicit break where it matters. */
  title: string;
  subtitle: string;
  children: ReactNode;
  /** Disabled until the step's minimum is met — see each screen for what that is. */
  canContinue: boolean;
  onContinue: () => void;
  continueLabel?: string;
  /** Rendered under the button when a step is genuinely optional. */
  onSkip?: () => void;
  skipLabel?: string;
  /** Steps whose content is long enough to need it scroll; the rest do not. */
  scrolls?: boolean;
}

export function OnboardingStep({
  step,
  title,
  subtitle,
  children,
  canContinue,
  onContinue,
  continueLabel = 'Continue',
  onSkip,
  skipLabel = 'Skip for now',
  scrolls = false,
}: OnboardingStepProps) {
  const router = useRouter();
  const styles = useStyles();

  const header = (
    <View style={styles.header}>
      <View style={styles.stepRow}>
        <Text style={styles.stepLabel}>
          Step {step} of {TOTAL_STEPS}
        </Text>
        <View style={styles.pips}>
          {Array.from({ length: TOTAL_STEPS }, (_, index) => (
            <View key={index} style={[styles.pip, index < step ? styles.pipDone : null]} />
          ))}
        </View>
      </View>
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </View>
  );

  const body = <Animated.View entering={FadeIn.duration(260)}>{children}</Animated.View>;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right', 'bottom']}>
      {step > 1 ? (
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={styles.back}>
          <Text style={styles.backGlyph}>‹</Text>
        </Pressable>
      ) : null}

      {scrolls ? (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled">
          {header}
          {body}
        </ScrollView>
      ) : (
        <View style={styles.content}>
          {header}
          {body}
        </View>
      )}

      <View style={styles.footer}>
        <PrimaryButton label={continueLabel} onPress={onContinue} disabled={!canContinue} />
        {onSkip ? (
          <Pressable onPress={onSkip} hitSlop={10} accessibilityRole="button" style={styles.skipTap}>
            <Text style={styles.skip}>{skipLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  back: {
    paddingHorizontal: screenPadding,
    paddingTop: spacing.xs,
    alignSelf: 'flex-start',
  },
  backGlyph: {
    fontSize: 32,
    lineHeight: 34,
    color: colors.textSecondary,
  },
  content: {
    flex: 1,
    paddingHorizontal: screenPadding + spacing.md,
    paddingTop: spacing.xl,
  },
  scrollContent: {
    paddingHorizontal: screenPadding + spacing.md,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
  },
  header: {
    gap: spacing.sm,
    marginBottom: spacing.xxl,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepLabel: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    color: colors.textTertiary,
  },
  pips: {
    flexDirection: 'row',
    gap: 5,
  },
  pip: {
    width: 18,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  pipDone: {
    backgroundColor: colors.accent,
  },
  title: {
    fontSize: fontSize.hero,
    fontWeight: '700',
    lineHeight: 38,
    letterSpacing: -1,
    color: colors.text,
  },
  subtitle: {
    fontSize: fontSize.body,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  footer: {
    paddingHorizontal: screenPadding + spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.md,
    alignItems: 'center',
  },
  skipTap: {
    paddingVertical: spacing.xs,
  },
  skip: {
    fontSize: fontSize.small + 1,
    fontWeight: '600',
    color: colors.textSecondary,
  },
}));
