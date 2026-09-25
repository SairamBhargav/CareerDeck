import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DeckMark } from '@/components/brand/DeckMark';
import { PrimaryButton } from '@/components/common/PrimaryButton';
import { fontSize, screenPadding, spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';

/**
 * The first thing anyone sees. Three cards stack up, the wordmark arrives under them,
 * then the copy and the button.
 *
 * It waits for a tap rather than advancing itself. An auto-advance reads as something
 * being skipped, and this is the one screen in the app whose entire job is to be looked
 * at for a second before anything is asked.
 *
 * Signed-out users land here, not on sign-in — see app/_layout.tsx. The way back to
 * sign-in is the link at the bottom, for people who already have an account.
 */
export default function WelcomeScreen() {
  const router = useRouter();
  const styles = useStyles();

  // The wordmark and everything under it wait for the last card to land, so the screen
  // reads as one gesture rather than three things appearing at once.
  const [settled, setSettled] = useState(false);
  const handleSettled = useCallback(() => setSettled(true), []);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.content}>
        <View style={styles.spacer} />

        <View style={styles.hero}>
          <DeckMark size={124} animated onSettled={handleSettled} />

          {settled ? (
            <Animated.View entering={FadeInDown.duration(420)} style={styles.words}>
              <Text style={styles.wordmark} accessibilityRole="header">
                CareerDeck
              </Text>
              <Text style={styles.tagline}>
                Internships and new-grad roles, and the people going for the same ones.
              </Text>
            </Animated.View>
          ) : (
            // Holds the space the wordmark is about to take, so the mark does not jump
            // upward the moment it lands.
            <View style={styles.wordsPlaceholder} />
          )}
        </View>

        {settled ? (
          <Animated.View entering={FadeIn.duration(360).delay(160)} style={styles.actions}>
            <PrimaryButton
              label="Get started"
              onPress={() => router.push('/onboarding/role')}
              accessibilityHint="Sets up your feed in three quick steps."
            />
            <Pressable
              onPress={() => router.push('/sign-in')}
              hitSlop={10}
              accessibilityRole="button"
              style={styles.linkTap}>
              <Text style={styles.link}>I already have an account</Text>
            </Pressable>
          </Animated.View>
        ) : (
          <View style={styles.actionsPlaceholder} />
        )}
      </View>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    paddingHorizontal: screenPadding + spacing.md,
    paddingBottom: spacing.xl,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  spacer: {
    height: spacing.xxl * 2,
  },
  hero: {
    alignItems: 'center',
    gap: spacing.xl + spacing.sm,
  },
  words: {
    alignItems: 'center',
    gap: spacing.md,
  },
  // Matches the rendered height of `words` closely enough that the mark holds still.
  wordsPlaceholder: {
    height: 96,
  },
  wordmark: {
    fontSize: fontSize.hero + 2,
    fontWeight: '700',
    letterSpacing: -1,
    color: colors.text,
  },
  tagline: {
    maxWidth: 268,
    textAlign: 'center',
    fontSize: fontSize.body,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  actions: {
    width: '100%',
    alignItems: 'center',
    gap: spacing.lg,
  },
  actionsPlaceholder: {
    height: 106,
  },
  linkTap: {
    paddingVertical: spacing.xs,
  },
  link: {
    fontSize: fontSize.small + 1,
    fontWeight: '600',
    color: colors.textSecondary,
  },
}));
