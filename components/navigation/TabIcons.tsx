import Svg, { Path, Rect } from 'react-native-svg';

interface TabIconProps {
  size?: number;
  color: string;
  /** The selected tab fills its mark; the others are drawn in line only. */
  filled?: boolean;
}

/*
 * Drawn here rather than taken from an icon set.
 *
 * Ionicons' house carries a door, a sill and a notch in the roofline — detail that reads
 * as decoration at 24pt and competes with the label underneath it. Its reel is a
 * play-in-a-circle, which is the symbol for video and says nothing about a deck of
 * postings.
 *
 * Both of these are the fewest strokes that still name the thing. One stroke weight, one
 * corner radius, no interior detail.
 */

const STROKE = 1.9;

/**
 * A roof and four walls. No chimney, no door, no path to the front step.
 */
export function HomeTabIcon({ size = 24, color, filled = false }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M3.4 10.2 12 3.6l8.6 6.6v8.3a1.5 1.5 0 0 1-1.5 1.5H4.9a1.5 1.5 0 0 1-1.5-1.5z"
        stroke={color}
        strokeWidth={STROKE}
        strokeLinejoin="round"
        fill={filled ? color : 'none'}
      />
    </Svg>
  );
}

/**
 * Three cards, fanned.
 *
 * The app's own mark is a deck being dealt, and this is that at a size where only the
 * stack survives: two cards leaning behind one upright. The back two stay outlined even
 * when selected, so the front card reads as the top of a pile rather than the whole thing
 * becoming a solid block.
 */
export function DeckTabIcon({ size = 24, color, filled = false }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {/* Furthest back, leaning hardest. */}
      <Rect
        x="4.1"
        y="6.4"
        width="10.4"
        height="13.4"
        rx="2.2"
        transform="rotate(-16 9.3 13.1)"
        stroke={color}
        strokeWidth={STROKE}
        strokeOpacity={0.55}
        fill="none"
      />
      <Rect
        x="6.6"
        y="5.2"
        width="10.4"
        height="13.4"
        rx="2.2"
        transform="rotate(-8 11.8 11.9)"
        stroke={color}
        strokeWidth={STROKE}
        strokeOpacity={0.75}
        fill="none"
      />
      {/* The top card, upright, and the only one that fills. */}
      <Rect
        x="9.6"
        y="4.4"
        width="10.4"
        height="13.4"
        rx="2.2"
        stroke={color}
        strokeWidth={STROKE}
        fill={filled ? color : 'none'}
      />
    </Svg>
  );
}
