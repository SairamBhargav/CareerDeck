import { StyleSheet, Text, View } from 'react-native';

import { colors, radius } from '@/constants/theme';

type LogoSize = 'sm' | 'md' | 'lg';

const SIZES: Record<LogoSize, { box: number; font: number; radius: number }> = {
  sm: { box: 36, font: 13, radius: radius.md },
  md: { box: 48, font: 16, radius: radius.lg },
  lg: { box: 60, font: 20, radius: radius.lg },
};

interface CompanyLogoProps {
  /** Monogram text, e.g. "NV". Replace with a real image source once we have logos. */
  logo: string;
  name: string;
  color?: string;
  size?: LogoSize;
  onDark?: boolean;
}

export function CompanyLogo({ logo, name, color, size = 'md', onDark = false }: CompanyLogoProps) {
  const dimensions = SIZES[size];
  const tint = color ?? colors.text;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${name} logo`}
      style={[
        styles.container,
        {
          width: dimensions.box,
          height: dimensions.box,
          borderRadius: dimensions.radius,
          backgroundColor: tint,
          borderColor: onDark ? colors.reelBorder : colors.border,
        },
      ]}>
      <Text style={[styles.text, { fontSize: dimensions.font }]} numberOfLines={1}>
        {logo}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  text: {
    color: colors.textInverse,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
});
