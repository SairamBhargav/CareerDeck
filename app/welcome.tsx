import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DeckMark } from '@/components/brand/DeckMark';
import { PrimaryButton } from '@/components/common/PrimaryButton';
import { fontSize, screenPadding, spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';

/**
 * The first thing anyone sees. Three cards slide in and stack onto each other, the
 * wordmark arrives under them, then the button.
 *
 * No tagline. The mark and the name are the whole statement — a line of copy underneath
 * asks to be read before anything has been offered, and pulls the eye off the thing the
 * screen just spent three quarters of a second drawing.
 *
 * It waits for a tap rather than advancing itself. An auto-advance reads as something
 * being skipped, and this is the one screen in the app whose entire job is to be looked
 * at for a second before anything is asked.
 *
 * Getting started swipes the deck off card by card and only then navigates, so the mark
 * hands the screen over instead of being cut off by the stack transition. The wordmark
 * and the button fade out underneath it — if they held still while the cards left, the
 * cards would read as falling off the screen rather than the screen moving on.
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

  const [leaving, setLeaving] = useState(false);
  const fade = useSharedValue(0);

  const leave = useCallback(() => setLeaving(true), []);

  // Navigating from here rather than from the tap is the whole point: the deck gets its
  // three hundred milliseconds before the stack takes the screen.
  const handleDismissed = useCallback(() => router.push('/onboarding/role'), [router]);

  // Coming back — the hardware back button, or the swipe gesture — finds this screen
  // still mounted and still mid-exit. Reset it, and let the deck restore itself.
  useFocusEffect(useCallback(() => setLeaving(false), []));

  // The fade follows `leaving` rather than being started by the tap, so both directions
  // come from one place: out on the way to step one, and straight back on a return, where
  // there is nothing to animate because the stack transition is already covering it.
  useEffect(() => {
    fade.value = leaving ? withTiming(1, { duration: 240 }) : 0;
    // Writing the shared value is the effect's whole job; it is stable by identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);

  const leavingStyle = useAnimatedStyle(() => ({
    opacity: 1 - fade.value,
    transform: [{ translateY: fade.value * 10 }],
  }));

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.content}>
        <View style={styles.spacer} />

        <View style={styles.hero}>
          <DeckMark
            size={124}
            animated
            onSettled={handleSettled}
            dismissed={leaving}
            onDismissed={handleDismissed}
          />

          {settled ? (
            <Animated.View
              entering={FadeInDown.duration(420)}
              style={[styles.words, leavingStyle]}>
              <Text style={styles.wordmark} accessibilityRole="header">
                CareerDeck
              </Text>
            </Animated.View>
          ) : (
            // Holds the space the wordmark is about to take, so the mark does not jump
            // upward the moment it lands.
            <View style={styles.wordsPlaceholder} />
          )}
        </View>

        {settled ? (
          <Animated.View
            entering={FadeIn.duration(360).delay(160)}
            style={[styles.actions, leavingStyle]}>
            <PrimaryButton
              label="Get started"
              onPress={leave}
              disabled={leaving}
              accessibilityHint="Sets up your feed in three quick steps."
            />
            <Pressable
              onPress={() => router.push('/sign-in')}
              disabled={leaving}
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
    height: 44,
  },
  wordmark: {
    fontSize: fontSize.hero + 2,
    fontWeight: '700',
    letterSpacing: -1,
    color: colors.text,
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
