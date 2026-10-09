import { StyleSheet, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';

import { radius } from '@/constants/theme';
import { SpinnerRing } from '@/components/common/Spinner';
import { makeStyles } from '@/context/ThemeContext';

/** Diameter of the indicator puck, and the strip the list holds open while refreshing. */
export const INDICATOR_SIZE = 46;
export const INDICATOR_TRAVEL = 54;

interface ReelsRefreshIndicatorProps {
  /** Drag progress: 0 at rest, 1 the moment the release threshold is reached. */
  pull: SharedValue<number>;
  /** 0 or 1 — springs to 1 for the duration of a refresh so the puck stays put after release. */
  active: SharedValue<number>;
  /** Free-running rotation, in degrees, while a refresh is in flight. */
  spin: SharedValue<number>;
  /** 0→1 loop that drives the expanding halo while a refresh is in flight. */
  pulse: SharedValue<number>;
  /** Distance from the top of the screen — the same line the reel's content starts on. */
  top: number;
}

/**
 * The Reels pull-to-refresh affordance: a violet bolt that scales up out of nothing as you
 * drag, tips over as it approaches the release point, then spins with an expanding halo
 * while the feed reloads. It borrows Auto Apply's violet so refreshing reads as the same
 * "the app is doing the work for you" gesture rather than a generic spinner.
 */
export function ReelsRefreshIndicator({ pull, active, spin, pulse, top }: ReelsRefreshIndicatorProps) {
  const styles = useStyles();

  // The puck is revealed by whichever is further along: the live drag, or a held refresh.
  const stackStyle = useAnimatedStyle(() => {
    const reveal = Math.max(pull.value, active.value);
    return {
      opacity: interpolate(reveal, [0, 0.3, 1], [0, 0.6, 1], Extrapolation.CLAMP),
      transform: [
        { translateY: interpolate(reveal, [0, 1], [-16, 0], Extrapolation.CLAMP) },
        { scale: interpolate(reveal, [0, 1], [0.45, 1], Extrapolation.CLAMP) },
      ],
    };
  });

  const boltStyle = useAnimatedStyle(() => {
    // 0→160° as you drag in, then spin takes over; 360° wraps seamlessly back to 0 so the
    // repeating rotation never visibly snaps.
    const tilt = interpolate(pull.value, [0, 1], [0, 160], Extrapolation.CLAMP);
    return {
      transform: [
        { rotate: `${tilt + spin.value}deg` },
        // Over-dragging past the threshold still does something, so the control stays alive.
        { scale: interpolate(pull.value, [1, 1.8], [1, 1.14], Extrapolation.CLAMP) },
      ],
    };
  });

  const haloStyle = useAnimatedStyle(() => ({
    opacity: (1 - pulse.value) * 0.55 * active.value,
    transform: [{ scale: interpolate(pulse.value, [0, 1], [1, 1.9]) }],
  }));

  return (
    <View pointerEvents="none" style={[styles.wrap, { top }]}>
      <Animated.View style={[styles.stack, stackStyle]}>
        {/*
          * The ring alone, where this was a shadowed puck with a glowing halo around a
          * lightning bolt. Three layers of chrome to say "loading" over a full-bleed card
          * that already has plenty going on — and the bolt meant "fast" where the gesture
          * means "again", wearing an icon Auto Apply had already taken.
          *
          * SpinnerRing rather than Spinner: the rotation is already driven here, across
          * the whole gesture including the wind-up as the finger pulls, so a
          * self-rotating component would turn twice.
          */}
        <Animated.View style={[styles.halo, haloStyle]} />
        <Animated.View style={boltStyle}>
          <SpinnerRing size={INDICATOR_SIZE - 8} stroke={2.5} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  stack: {
    width: INDICATOR_SIZE,
    height: INDICATOR_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /*
   * A ripple that leaves as the refresh starts, rather than a permanent ring around a
   * puck. It is the only thing left of the old chrome, kept because the gesture needs one
   * beat of acknowledgement at the moment it fires.
   */
  halo: {
    position: 'absolute',
    width: INDICATOR_SIZE,
    height: INDICATOR_SIZE,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.autoApply,
  },
}));
