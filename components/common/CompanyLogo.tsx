import { Image, StyleSheet, Text, View } from 'react-native';

import { colors, radius } from '@/constants/theme';

type LogoSize = 'sm' | 'md' | 'lg';

const SIZES: Record<LogoSize, { box: number; font: number; radius: number }> = {
  sm: { box: 36, font: 13, radius: radius.md },
  md: { box: 48, font: 16, radius: radius.lg },
  lg: { box: 60, font: 20, radius: radius.lg },
};

const isRemoteLogo = (logo: string) => /^https?:\/\//.test(logo);

interface CompanyLogoProps {
  /** Company logo URL, or a fallback monogram text when a real logo is unavailable. */
  logo: string;
  name: string;
  color?: string;
  size?: LogoSize;
  onDark?: boolean;
}

export function CompanyLogo({ logo, name, color, size = 'md', onDark = false }: CompanyLogoProps) {
  const dimensions = SIZES[size];
  const tint = color ?? colors.text;
  const isImageLogo = isRemoteLogo(logo);

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
          backgroundColor: isImageLogo ? colors.surface : tint,
          borderColor: onDark ? colors.reelBorder : colors.border,
        },
      ]}>
      {isImageLogo ? (
        <Image
          source={{ uri: logo }}
          resizeMode="contain"
          style={[
            styles.image,
            {
              width: dimensions.box - 10,
              height: dimensions.box - 10,
              borderRadius: dimensions.radius - 4,
            },
          ]}
        />
      ) : (
        <Text style={[styles.text, { fontSize: dimensions.font }]} numberOfLines={1}>
          {logo}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  image: {
    alignSelf: 'center',
    backgroundColor: 'transparent',
  },
  text: {
    color: colors.textInverse,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
});
