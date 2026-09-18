import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { radius } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';

type LogoSize = 'sm' | 'md' | 'lg' | 'xl';
type LogoShape = 'rounded' | 'circle';

const SIZES: Record<LogoSize, { box: number; font: number; radius: number }> = {
  sm: { box: 36, font: 13, radius: radius.md },
  md: { box: 48, font: 16, radius: radius.lg },
  lg: { box: 60, font: 20, radius: radius.lg },
  xl: { box: 62, font: 22, radius: radius.lg },
};

const isRemoteLogo = (logo: string) => /^https?:\/\//.test(logo);

/** "NVIDIA" -> "NV", "Citadel" -> "CI" — same shape as the mock data's own monograms. */
function monogramOf(name: string): string {
  const letters = name.replace(/[^a-zA-Z]/g, '');
  return (letters.slice(0, 2) || name.slice(0, 2)).toUpperCase();
}

interface CompanyLogoProps {
  /** Company logo URL, or a fallback monogram text when a real logo is unavailable. */
  logo: string;
  name: string;
  color?: string;
  size?: LogoSize;
  /** Stories use full circles; everywhere else keeps the squircle plate. */
  shape?: LogoShape;
}

export function CompanyLogo({ logo, name, color, size = 'md', shape = 'rounded' }: CompanyLogoProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  // A URL that 404s or times out still "isImageLogo" by shape — this is what actually
  // drops it back to the monogram plate once the load fails.
  const [imageFailed, setImageFailed] = useState(false);

  const dimensions = SIZES[size];
  const isCircle = shape === 'circle';
  const imageBox = dimensions.box - 10;
  const tint = color ?? colors.text;
  const showImage = isRemoteLogo(logo) && !imageFailed;
  const monogram = isRemoteLogo(logo) ? monogramOf(name) : logo;

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
          borderRadius: isCircle ? dimensions.box / 2 : dimensions.radius,
          // Real logos are nearly always dark-on-transparent, so they keep a light plate
          // in both schemes; a monogram sits directly on the company's brand colour.
          backgroundColor: showImage ? '#FFFFFF' : tint,
        },
      ]}>
      {showImage ? (
        <Image
          source={{ uri: logo }}
          resizeMode="contain"
          onError={() => setImageFailed(true)}
          style={[
            styles.image,
            {
              width: imageBox,
              height: imageBox,
              borderRadius: isCircle ? imageBox / 2 : dimensions.radius - 4,
            },
          ]}
        />
      ) : (
        <Text style={[styles.text, { fontSize: dimensions.font }]} numberOfLines={1}>
          {monogram}
        </Text>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  image: {
    alignSelf: 'center',
    backgroundColor: 'transparent',
  },
  text: {
    // Always white: this sits on the company's own brand colour, not a themed surface.
    color: colors.textOnBrand,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
}));
