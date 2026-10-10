import Ionicons from '@expo/vector-icons/Ionicons';
import { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

import { usePaywallColors } from '@/components/paywall/palette';
import { useTheme } from '@/context/ThemeContext';

interface AutoApplyMarkProps {
  /** The ring's outer diameter. The Deck's rail draws it at 48. */
  size?: number;
  /** No credits left: the ring fades and the bolt goes quiet, as on the rail. */
  spent?: boolean;
}

/**
 * Auto Apply's symbol: an outlined bolt in the page's ink, inside a thin violet, magenta
 * and gold ring.
 *
 * Shared so every place that talks about Auto Apply shows the button it means. Why the
 * bolt is ink and outlined rather than coloured or solid is written up where the mark
 * first lived, on the Deck's action rail (components/reels/ReelActionRail.tsx).
 */
export function AutoApplyMark({ size = 48, spent = false }: AutoApplyMarkProps) {
  const { colors } = useTheme();
  const pro = usePaywallColors();
  // Two marks on one screen must not share a gradient id, or one ring paints with the
  // other's definition.
  const gradientId = `autoApplyRing-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const stroke = size >= 40 ? 1.75 : 1.5;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={pro.violet} />
            <Stop offset="0.55" stopColor={pro.magenta} />
            <Stop offset="1" stopColor={pro.gold} />
          </LinearGradient>
        </Defs>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={(size - stroke) / 2}
          stroke={`url(#${gradientId})`}
          strokeWidth={stroke}
          fill="none"
          strokeOpacity={spent ? 0.32 : 1}
        />
      </Svg>
      <Ionicons
        name="flash-outline"
        size={Math.round(size * 0.46)}
        color={spent ? colors.textTertiary : colors.text}
      />
    </View>
  );
}
