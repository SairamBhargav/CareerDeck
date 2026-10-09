import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type FollowButtonSize = 'sm' | 'md';

/**
 * `solid` is the filled pill — for a company's own page, where following is the point of
 * the screen and deserves the weight.
 *
 * `minimal` is an icon and a label with nothing drawn behind them, for the lists where a
 * company is one of ten and the button is not what the row is for. A filled near-black
 * pill repeated down a carousel reads as ten things shouting; the same control as plain
 * text reads as an offer.
 */
type FollowButtonVariant = 'solid' | 'minimal';

const SIZES: Record<FollowButtonSize, { minHeight: number; paddingHorizontal: number; font: number }> = {
  sm: { minHeight: 32, paddingHorizontal: spacing.md, font: fontSize.caption + 1 },
  md: { minHeight: 38, paddingHorizontal: spacing.lg, font: fontSize.small },
};

/** How long the ring takes to travel out and fade. Short — it's punctuation, not a cutscene. */
const BURST_MS = 420;
/** The pop the pill itself gives when the follow lands. */
const POP_SPRING = { damping: 12, stiffness: 420, mass: 0.5 };
const COLOR_MS = 220;

interface FollowButtonProps {
  isFollowing: boolean;
  companyName: string;
  onToggle: () => void;
  size?: FollowButtonSize;
  variant?: FollowButtonVariant;
  style?: ViewStyle;
}

/**
 * The one follow control, shared by the suggestion cards, search results and a company's
 * own page — they had three different-looking buttons before this.
 *
 * Following is the only thing in the app a user does *to* a company, and it otherwise
 * gives nothing back: the label changes and that's it. So it gets a small celebration —
 * a ring that pushes out past the pill, a spring pop, and a success haptic. Unfollowing
 * deliberately gets none of it, only a quiet selection tick; taking something back
 * shouldn't feel like an achievement.
 */
export function FollowButton({
  isFollowing,
  companyName,
  onToggle,
  size = 'sm',
  variant = 'solid',
  style,
}: FollowButtonProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const metrics = SIZES[size];
  const minimal = variant === 'minimal';

  // The mark leads the label in both states, as a plus and then a tick.
  const markColor = isFollowing ? colors.textSecondary : minimal ? colors.accent : colors.accentText;

  // Bumped on each *follow* so the burst can re-run; a plain boolean couldn't retrigger
  // it, and a shared value written from here would be a JS-side mutation.
  const [burstKey, setBurstKey] = useState(0);
  // A follow happened while this button was mounted — so the checkmark animates in on
  // the follow the user just made, but not on one that was already true at first paint.
  const followedHere = burstKey > 0;

  const followed = useDerivedValue(
    () => withTiming(isFollowing ? 1 : 0, { duration: COLOR_MS }),
    [isFollowing],
  );

  const burst = useDerivedValue(() => {
    if (burstKey === 0) return 0;
    // Out and gone, then snapped back to zero so the next follow starts from rest.
    return withSequence(
      withTiming(1, { duration: BURST_MS, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: 0 }),
    );
  }, [burstKey]);

  const pop = useDerivedValue(() => {
    if (burstKey === 0) return 1;
    return withSequence(withSpring(1.08, POP_SPRING), withSpring(1, POP_SPRING));
  }, [burstKey]);

  /*
   * Both branches return the same keys. Reanimated wants a stable shape out of an
   * animated style, so the minimal variant paints transparent rather than omitting the
   * fill.
   */
  const pillStyle = useAnimatedStyle(() => ({
    backgroundColor: minimal
      ? 'transparent'
      : interpolateColor(followed.value, [0, 1], [colors.accent, colors.backgroundMuted]),
    borderColor: minimal
      ? 'transparent'
      : interpolateColor(followed.value, [0, 1], [colors.accent, colors.border]),
    transform: [{ scale: pop.value }],
  }));

  const labelStyle = useAnimatedStyle(() => ({
    // Minimal carries the state in the text itself, so it starts at the strongest colour
    // in the palette and settles to a quiet one once the thing is done.
    color: minimal
      ? interpolateColor(followed.value, [0, 1], [colors.accent, colors.textSecondary])
      : interpolateColor(followed.value, [0, 1], [colors.accentText, colors.textSecondary]),
  }));

  const ringStyle = useAnimatedStyle(() => ({
    opacity: interpolate(burst.value, [0, 0.15, 1], [0, 0.45, 0]),
    transform: [{ scale: interpolate(burst.value, [0, 1], [1, 1.45]) }],
  }));

  const handlePress = () => {
    if (isFollowing) {
      Haptics.selectionAsync();
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setBurstKey((key) => key + 1);
    }
    onToggle();
  };

  return (
    <View style={[styles.wrap, style]}>
      {/* Outside the pill and non-interactive, so it can overflow past the button's
          bounds without eating taps meant for the card underneath. Skipped in the minimal
          variant: a ring bursting out of a shape that was never drawn reads as a glitch. */}
      {minimal ? null : (
        <Animated.View pointerEvents="none" style={[styles.ring, { borderRadius: radius.pill }, ringStyle]} />
      )}

      <AnimatedPressable
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityState={{ selected: isFollowing }}
        accessibilityLabel={isFollowing ? `Unfollow ${companyName}` : `Follow ${companyName}`}
        // A borderless control still needs a target, so the padding it loses comes back
        // as hitSlop rather than as empty space inside a card that is only 132pt wide.
        hitSlop={minimal ? 10 : undefined}
        style={[
          styles.pill,
          minimal ? styles.pillMinimal : null,
          {
            minHeight: metrics.minHeight,
            paddingHorizontal: minimal ? 0 : metrics.paddingHorizontal,
          },
          pillStyle,
        ]}>
        {isFollowing ? (
          <Animated.View entering={followedHere ? FadeIn.duration(160) : undefined} style={styles.check}>
            <Ionicons name="checkmark" size={metrics.font + 3} color={markColor} />
          </Animated.View>
        ) : minimal ? (
          <Ionicons name="add" size={metrics.font + 4} color={markColor} />
        ) : null}

        <Animated.Text style={[styles.label, { fontSize: metrics.font }, labelStyle]}>
          {isFollowing ? 'Following' : 'Follow'}
        </Animated.Text>
      </AnimatedPressable>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: {
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 2,
    borderColor: colors.accent,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillMinimal: {
    borderWidth: 0,
  },
  check: {
    justifyContent: 'center',
  },
  label: {
    fontWeight: '700',
  },
}));
