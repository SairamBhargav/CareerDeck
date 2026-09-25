import type { ReactNode } from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

import { spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';

/**
 * A scrolling region that fills the space it is given, with a thin rail in its right
 * gutter, for content that overflows inside a screen whose layout should not move.
 *
 * ── Why a pane rather than scrolling the screen ────────────────────────────────
 *
 * Making the whole screen scroll is the obvious answer and the wrong one here. The
 * onboarding steps are composed: a fixed headline, a body, a button pinned to the bottom.
 * Scroll the screen and the headline slides away, the page grows as long as its longest
 * step, and the three steps stop feeling like one sequence — which is the entire reason
 * OnboardingStep exists. A pane keeps every step exactly the same height and lets only
 * the part with more in it move.
 *
 * ── The rail ───────────────────────────────────────────────────────────────────
 *
 * It replaces the platform scrollbar, which is wrong for this in two ways: iOS hides its
 * bar until you touch, and on a region whose whole job is to say "there is more below"
 * that is backwards; and the platform bar appears hard against the screen edge rather
 * than in the content's gutter. This one is quiet but always there while the content
 * overflows, and hides itself the moment it fits.
 *
 * There is no drawn track behind the thumb — only the thumb. A full-height line down the
 * side of a screen is a second edge competing with the real one, and it is redundant:
 * the thumb's position and length already say where you are and how much there is. What
 * remains is the smallest mark that answers the question.
 *
 * Everything the rail does is computed on the UI thread from shared values. Nothing here
 * causes a React render while the finger is down.
 */

/** Thin enough to stay out of the way, wide enough to read as a deliberate element. */
const RAIL_WIDTH = 3;

/** Below this the thumb stops shrinking, or a long list ends up with an invisible one. */
const MIN_THUMB = 28;

/** Slack before the rail appears: overflow under this is rounding, not scrollable. */
const OVERFLOW_EPSILON = 2;

export interface ScrollPaneProps {
  children: ReactNode;
  /**
   * Extra room under the last row, so the final item does not sit flush against the
   * bottom edge and read as cut off.
   */
  bottomInset?: number;
}

export function ScrollPane({ children, bottomInset = spacing.lg }: ScrollPaneProps) {
  const styles = useStyles();

  const scrollY = useSharedValue(0);
  const viewport = useSharedValue(0);
  const content = useSharedValue(0);
  const track = useSharedValue(0);

  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });

  const trackStyle = useAnimatedStyle(() => ({
    opacity: content.value - viewport.value > OVERFLOW_EPSILON ? 1 : 0,
  }));

  const thumbStyle = useAnimatedStyle(() => {
    const overflow = content.value - viewport.value;
    if (track.value <= 0 || overflow <= OVERFLOW_EPSILON) {
      return { height: 0, transform: [{ translateY: 0 }] };
    }

    const height = Math.max(MIN_THUMB, track.value * (viewport.value / content.value));
    // Clamped because both ends of a scroll overshoot past their bounds on iOS, and an
    // unclamped thumb rides straight out of its track during the bounce.
    const progress = Math.min(1, Math.max(0, scrollY.value / overflow));

    return {
      height,
      transform: [{ translateY: progress * (track.value - height) }],
    };
  });

  return (
    <View style={styles.pane}>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        onLayout={(event) => {
          viewport.value = event.nativeEvent.layout.height;
        }}
        onContentSizeChange={(_width, height) => {
          content.value = height;
        }}
        contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        {children}
      </Animated.ScrollView>

      {/* Outside the ScrollView, so it holds still instead of scrolling away with the
          content it is describing. */}
      <Animated.View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        onLayout={(event) => {
          track.value = event.nativeEvent.layout.height;
        }}
        style={[styles.track, trackStyle]}>
        <Animated.View style={[styles.thumb, thumbStyle]} />
      </Animated.View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  pane: {
    flex: 1,
    // Without this a flex child refuses to shrink below its content's height, which turns
    // the pane into an overflowing block that never scrolls.
    minHeight: 0,
  },
  content: {
    // Leaves the rail its gutter, so no row ever runs underneath it.
    paddingRight: spacing.lg,
  },
  // Spans the pane but draws nothing: it is the space the thumb travels in, not a line.
  track: {
    position: 'absolute',
    right: 0,
    top: 2,
    bottom: 2,
    width: RAIL_WIDTH,
  },
  thumb: {
    width: RAIL_WIDTH,
    borderRadius: RAIL_WIDTH,
    backgroundColor: colors.textTertiary,
    opacity: 0.55,
  },
}));
