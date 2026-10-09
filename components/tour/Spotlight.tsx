import { StyleSheet, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import Svg, { Defs, Mask, Rect } from 'react-native-svg';

import type { WindowRect } from '@/components/tour/PulseRing';
import { useTheme } from '@/context/ThemeContext';

const OUTSET = 6;

/**
 * Dims everything but the one control the step asks for.
 *
 * The ring alone said "here" and left the rest of the screen just as loud, so a reader still had
 * to find it among a dozen other tappable things. With the screen behind a scrim and a hole cut
 * around the target, there is only one thing left to look at. Never takes a touch: the control
 * shows through the hole, and the real one underneath is what gets tapped.
 */
export function Spotlight({ rect }: { rect: WindowRect }) {
  const { scheme } = useTheme();
  const { width, height } = useWindowDimensions();
  const r = (rect.radius ?? Math.min(rect.width, rect.height) / 2) + OUTSET;

  return (
    <Animated.View
      key={`${Math.round(rect.x)}:${Math.round(rect.y)}`}
      entering={FadeIn.duration(220)}
      exiting={FadeOut.duration(120)}
      pointerEvents="none"
      style={StyleSheet.absoluteFill}>
      <Svg width={width} height={height}>
        <Defs>
          <Mask id="tourSpotlight" x="0" y="0" width={width} height={height}>
            <Rect x="0" y="0" width={width} height={height} fill="#FFFFFF" />
            <Rect
              x={rect.x - OUTSET}
              y={rect.y - OUTSET}
              width={rect.width + OUTSET * 2}
              height={rect.height + OUTSET * 2}
              rx={r}
              ry={r}
              fill="#000000"
            />
          </Mask>
        </Defs>
        <Rect
          x="0"
          y="0"
          width={width}
          height={height}
          fill={scheme === 'dark' ? 'rgba(0,0,0,0.6)' : 'rgba(17,17,20,0.42)'}
          mask="url(#tourSpotlight)"
        />
      </Svg>
    </Animated.View>
  );
}
