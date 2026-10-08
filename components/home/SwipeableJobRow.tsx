import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { radius, screenPadding, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';

/**
 * Travel that commits the swipe. A third of a phone's width is further than a thumb moves
 * while scrolling and well short of the edge, so neither action happens by brushing past.
 */
const COMMIT_PX = 96;

/** A confident flick commits early, so the gesture does not require the full distance. */
const COMMIT_VELOCITY = 800;

/** Travel at which the wash reaches full strength — before the commit point, so the colour
 *  tells you what will happen while there is still time to change your mind. */
const WASH_FULL_PX = 72;

const FLING = { duration: 180 };
const SPRING_BACK = { duration: 200 };
const COLLAPSE = { duration: 200 };

/*
 * The collapse starts before the card has finished leaving.
 *
 * Run end to end they read as two events — a card leaves, then a gap closes. Overlapping
 * them reads as one: the row closes behind the card on its way out, which is the thing the
 * reader actually asked for by swiping.
 */
const COLLAPSE_DELAY_MS = 90;

interface SwipeableJobRowProps {
  children: ReactNode;
  /** Left: writes `hide`, which the ranker treats as a hard filter. */
  onHide: () => void;
  /** Right: writes `like`, and the row leaves the feed for this session. */
  onLike: () => void;
}

/**
 * Home's feed row, swipeable in both directions.
 *
 * Left hides the posting, right likes it; either way the row closes and the rest come up.
 * Both are reversible from the undo bar the caller shows, which is the only reason a hard
 * filter is safe to put behind a flick.
 *
 * ── Why the gesture can win at all ────────────────────────────────────────────────
 *
 * `activeOffsetX` claims the horizontal axis once the finger has travelled 14px across,
 * and `failOffsetY` hands the gesture back the moment it looks vertical, so the feed still
 * scrolls through these rows untouched. It is the same arrangement CommentRow uses inside
 * the comment thread.
 *
 * That is not enough on its own here. Home rides on react-native-tab-view, which wraps
 * react-native-pager-view — a *native* pager, so it wins arbitration against a JS gesture
 * and offers no handler ref to block. Home therefore sets `swipeEnabled: false` in the tabs
 * layout, which is what actually leaves the horizontal axis free for these rows. Swiping
 * back from Deck still works, because the flag only applies while Home is the focused
 * screen.
 */
export function SwipeableJobRow({ children, onHide, onLike }: SwipeableJobRowProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { width } = useWindowDimensions();

  const translateX = useSharedValue(0);
  const collapse = useSharedValue(0);

  /*
   * Measured once and then kept.
   *
   * Collapsing needs a pixel height to animate towards zero, and `height: undefined` until
   * the first layout means the row sizes itself normally and the measurement changes
   * nothing when it arrives. A row's height is fixed for a given posting — the title is
   * capped at two lines — so there is nothing to re-measure.
   */
  const rowHeight = useSharedValue(0);
  const measured = useSharedValue(false);

  const commit = (direction: 'left' | 'right') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (direction === 'left') onHide();
    else onLike();
  };

  const pan = Gesture.Pan()
    .activeOffsetX([-14, 14])
    .failOffsetY([-12, 12])
    .onUpdate((event) => {
      'worklet';
      translateX.set(event.translationX);
    })
    .onEnd((event) => {
      'worklet';
      const travelled = Math.abs(translateX.value) >= COMMIT_PX;
      const flicked = Math.abs(event.velocityX) >= COMMIT_VELOCITY;

      if (!travelled && !flicked) {
        translateX.set(withTiming(0, SPRING_BACK));
        return;
      }

      // Direction comes from where the card is, not which way the finger was last moving:
      // a flick that ends travelling back towards centre still means the side it reached.
      const right = translateX.value > 0;
      translateX.set(withTiming(right ? width : -width, FLING));
      collapse.set(
        withDelay(
          COLLAPSE_DELAY_MS,
          withTiming(1, COLLAPSE, (finished) => {
            // Only on a real finish. An interrupted animation means this row was unmounted
            // or reset under us, and firing then would write an interaction nobody asked for.
            if (finished) runOnJS(commit)(right ? 'right' : 'left');
          }),
        ),
      );
    });

  const rowStyle = useAnimatedStyle(() => ({
    height: measured.value ? rowHeight.value * (1 - collapse.value) : undefined,
    opacity: 1 - collapse.value,
  }));

  const slideStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  /*
   * Two washes rather than one interpolated colour. They mean opposite things, so they get
   * their own layers and each fades in only on its own side — there is no midpoint between
   * "hide this" and "like this" worth rendering.
   */
  const hideWash = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, -translateX.value) / WASH_FULL_PX),
  }));

  const likeWash = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, translateX.value) / WASH_FULL_PX),
  }));

  return (
    <Animated.View
      style={[styles.row, rowStyle]}
      onLayout={(event) => {
        if (measured.value) return;
        rowHeight.set(event.nativeEvent.layout.height);
        measured.set(true);
      }}>
      <GestureDetector gesture={pan}>
        <Animated.View style={slideStyle}>
          {children}

          {/* Over the card rather than revealed from under it: the house rule is that state
              shows in a surface's own fill, so the card tints instead of uncovering a panel. */}
          <Animated.View style={[styles.wash, styles.hideSurface, hideWash]} pointerEvents="none">
            <View style={styles.washIcon}>
              <Ionicons name="eye-off-outline" size={20} color={colors.textSecondary} />
            </View>
          </Animated.View>

          <Animated.View style={[styles.wash, styles.likeSurface, likeWash]} pointerEvents="none">
            <View style={[styles.washIcon, styles.washIconLeft]}>
              <Ionicons name="heart" size={20} color={colors.like} />
            </View>
          </Animated.View>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

const useStyles = makeStyles((colors) => ({
  /*
   * The padding that used to live on Home's own row wrapper now belongs here, so the
   * collapse takes the gap with it. Left outside, a hidden row would leave 12pt of nothing
   * behind and the rest would not come all the way up.
   */
  row: {
    paddingHorizontal: screenPadding,
    paddingBottom: spacing.md,
    // The card travels past the gutter on its way out; nothing should be clipped at the edge.
    overflow: 'visible',
  },
  wash: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: radius.lg,
    justifyContent: 'center',
  },
  /*
   * Grey, not red.
   *
   * `danger` is reserved by the palette for "something the user has to act on", and the
   * comment there is explicit that sharing a red between a failure and an affection makes
   * one of them mean less. Hiding a posting is neither — it is a preference, so it reads as
   * the row going quiet.
   */
  hideSurface: {
    backgroundColor: colors.backgroundMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  likeSurface: {
    backgroundColor: colors.likeSurface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.likeBorder,
  },
  /*
   * Each icon sits on the card's trailing edge — hide on the right, like on the left.
   *
   * The wash travels with the card rather than being uncovered behind it, so the question is
   * not which direction the icon arrives from but which part of the card is still on screen
   * at the moment the swipe commits. A card leaving to the left is last seen by its right
   * edge, so that is where the icon has to be to be read at all.
   */
  washIcon: {
    position: 'absolute',
    right: spacing.lg,
  },
  washIconLeft: {
    right: undefined,
    left: spacing.lg,
  },
}));
