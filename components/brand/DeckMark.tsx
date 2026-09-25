import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { makeStyles, useTheme } from '@/context/ThemeContext';

/**
 * The CareerDeck mark: three cards in a deck, the front one carrying a company chip and
 * two text lines — the same structure as a real posting in the feed.
 *
 * Drawn rather than imported. A `<View>` mark costs nothing at any size, re-themes for
 * dark mode without a second asset, and animates per-card, which is the whole point of
 * the welcome screen. An SVG or PNG would need an export per size per scheme and could
 * not stack itself.
 *
 * ── The geometry ──────────────────────────────────────────────────────────────
 *
 * Everything is expressed against a 132pt box and scaled from there, so one set of
 * numbers holds from the 26pt header lockup to the 120pt welcome screen. The rotations
 * are deliberately uneven (-13°, -6.5°, 0°): an even fan reads as a UI element, an uneven
 * one reads as cards someone put down.
 *
 * ── Why the third card disappears when small ──────────────────────────────────
 *
 * Below `THREE_CARD_MIN` the back card is a two-pixel sliver that renders as a smudge on
 * one device and a hairline on the next. Two cards still say "stack"; three say nothing.
 *
 * ── The deal ──────────────────────────────────────────────────────────────────
 *
 * Each card slides in from the right, a touch low and held nearer upright than it ends,
 * then tips into its angle as it stops — a card being pushed onto the pile and settling
 * against the ones already there. Deliberately not a rise-and-fade: cards arrive opaque
 * and early (see the opacity ramp), because a card still translucent when it lands reads
 * as an element appearing rather than an object being placed.
 *
 * The stagger is longer than a third of the travel, so the three landings are three
 * separate events. Shorter and they blur into one indistinct movement.
 */

/** The box every other measurement is a fraction of. */
const BASE = 132;

const CARD = { w: 84, h: 104, radius: 20 };

/** left/top within the base box, and the rotation, back card first. */
const LAYOUT = [
  { left: 14, top: 18, rotate: -13 },
  { left: 22, top: 14, rotate: -6.5 },
  { left: 30, top: 10, rotate: 0 },
] as const;

/** Under this width the mark drops to two cards. */
const THREE_CARD_MIN = 44;

/** Per-card stagger on the deal, and how long one card takes to travel. */
const STAGGER_MS = 150;
const CARD_MS = 420;

/** Where a card begins its slide, in base-box points relative to where it lands. */
const DEAL = { x: 62, y: 16, rotate: 9 };

export interface DeckMarkProps {
  /** Width of the mark's box in points. Height follows at 126/132 of it. */
  size?: number;
  /**
   * Plays the deal once on mount. Off by default: the mark is used in
   * headers and lockups far more often than it is used as a hero.
   */
  animated?: boolean;
  /** Fires when the last card lands, so a caller can sequence a wordmark after it. */
  onSettled?: () => void;
  /**
   * Renders the front card light-on-dark regardless of scheme — for a dark plate, like
   * the app icon, where the mark sits on its own background rather than the page's.
   */
  inverted?: boolean;
}

export function DeckMark({
  size = BASE,
  animated = false,
  onSettled,
  inverted = false,
}: DeckMarkProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const reducedMotion = useReducedMotion();

  const scale = size / BASE;
  const showThird = size >= THREE_CARD_MIN;
  const play = animated && !reducedMotion;

  // One value per card, 0 = still off to the right, 1 = landed. Cards that are not
  // animating start landed, so the same component serves both cases without a branch in
  // the markup.
  const back = useSharedValue(play ? 0 : 1);
  const mid = useSharedValue(play ? 0 : 1);
  const front = useSharedValue(play ? 0 : 1);

  // Held in a ref so the worklet below closes over one stable function rather than
  // re-running the whole entrance every time the caller re-renders. Assigned in an
  // effect, not during render — a ref written while rendering is read back stale on the
  // pass that matters.
  const settled = useRef(onSettled);

  useEffect(() => {
    settled.current = onSettled;
  }, [onSettled]);

  useEffect(() => {
    const announce = () => settled.current?.();

    if (!play) {
      // Reduced motion still gets the callback, or a welcome screen would wait forever
      // for a wordmark that never arrives.
      announce();
      return;
    }

    // Decisive push, hard deceleration: the card carries speed most of the way and then
    // stops against the stack rather than drifting into place.
    const ease = { duration: CARD_MS, easing: Easing.bezier(0.16, 1, 0.3, 1) };
    back.value = withDelay(0, withTiming(1, ease));
    mid.value = withDelay(STAGGER_MS, withTiming(1, ease));
    front.value = withDelay(
      STAGGER_MS * 2,
      withTiming(1, ease, (finished) => {
        'worklet';
        if (finished) runOnJS(announce)();
      }),
    );
    // Writing the shared values is the effect's whole job; they are stable by identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play]);

  return (
    <View style={[styles.box, { width: size, height: size * (126 / BASE) }]}>
      {showThird ? (
        <Card progress={back} index={0} scale={scale} fill={colors.border} inverted={inverted} />
      ) : null}
      <Card progress={mid} index={1} scale={scale} fill={colors.borderStrong} inverted={inverted} />
      <Card
        progress={front}
        index={2}
        scale={scale}
        fill={inverted ? '#FFFFFF' : colors.accent}
        inverted={inverted}
        front
      />
    </View>
  );
}

interface CardProps {
  progress: SharedValue<number>;
  index: 0 | 1 | 2;
  scale: number;
  fill: string;
  inverted: boolean;
  front?: boolean;
}

function Card({ progress, index, scale, fill, inverted, front = false }: CardProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const spot = LAYOUT[index] ?? LAYOUT[2];

  const animatedStyle = useAnimatedStyle(() => {
    const p = progress.value;
    const left = 1 - p;
    return {
      // Opaque by a third of the way in, so the rest of the travel is a solid card
      // moving — that is what makes it read as being placed rather than appearing.
      opacity: Math.min(1, p * 3),
      transform: [
        { translateX: left * DEAL.x * scale },
        { translateY: left * DEAL.y * scale },
        // Ends *more* turned than it starts: the fan opens under the card as it sets
        // down, instead of the card unwinding onto a fan that was already there.
        { rotate: `${spot.rotate + left * DEAL.rotate}deg` },
        { scale: 1 + left * 0.03 },
      ],
    };
  });

  const ink = inverted ? '#0E0F13' : colors.accentText;

  return (
    <Animated.View
      style={[
        styles.card,
        {
          left: spot.left * scale,
          top: spot.top * scale,
          width: CARD.w * scale,
          height: CARD.h * scale,
          borderRadius: CARD.radius * scale,
          backgroundColor: fill,
          padding: 16 * scale,
        },
        animatedStyle,
      ]}>
      {front ? (
        <>
          <View
            style={{
              width: 22 * scale,
              height: 22 * scale,
              borderRadius: 7 * scale,
              backgroundColor: ink,
            }}
          />
          <View style={{ gap: 6 * scale, marginTop: 10 * scale }}>
            <View
              style={{
                width: 46 * scale,
                height: 6 * scale,
                borderRadius: 3 * scale,
                backgroundColor: ink,
                opacity: 0.92,
              }}
            />
            <View
              style={{
                width: 30 * scale,
                height: 6 * scale,
                borderRadius: 3 * scale,
                backgroundColor: ink,
                opacity: 0.42,
              }}
            />
          </View>
        </>
      ) : null}
    </Animated.View>
  );
}

const useStyles = makeStyles(() => ({
  box: {
    position: 'relative',
  },
  card: {
    position: 'absolute',
  },
}));
