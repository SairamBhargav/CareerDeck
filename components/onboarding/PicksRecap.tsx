import { Text, View } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';

import { CompanyLogo } from '@/components/common/CompanyLogo';
import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';
import { useOnboarding } from '@/context/OnboardingContext';
import { useCompanyDirectory } from '@/hooks/useCompanies';

/** Past this many the stack stops reading as a row of logos and starts reading as a wall. */
const MAX_LOGOS = 4;

/** "Anthropic and Stripe", "Anthropic, Stripe and Ramp", "Anthropic, Stripe and 3 more". */
function namesLine(names: string[]): string {
  if (names.length <= 2) return names.join(' and ');
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/**
 * The companies just followed, as an overlapping row of logos under the sign-up title.
 *
 * It is what "Save your picks." refers to. Names, not counts: "3 interests · 7 a week"
 * read as a receipt, while the companies are the part somebody recognises at a glance
 * and the reason the next screen is worth reaching.
 */
export function PicksRecap() {
  const styles = useStyles();
  const { followedCompanySlugs } = useOnboarding();
  const directory = useCompanyDirectory();

  const followed = followedCompanySlugs
    .map((slug) => directory.bySlug.get(slug))
    .filter((company) => company !== undefined);

  if (followed.length === 0) return null;

  const logos = followed.slice(0, MAX_LOGOS);
  const names = namesLine(followed.map((company) => company.name));

  return (
    <Animated.View entering={FadeIn.duration(280).delay(120)} style={styles.card} accessible>
      <View style={styles.logos}>
        {logos.map((company, index) => (
          <Animated.View
            key={company.id}
            entering={ZoomIn.duration(240).delay(160 + index * 70)}
            style={[styles.logo, index > 0 ? styles.logoOverlap : null]}>
            <CompanyLogo logo={company.logo} name={company.name} color={company.logoColor} size="sm" />
          </Animated.View>
        ))}
      </View>
      <View style={styles.text}>
        <Text style={styles.names} numberOfLines={1}>
          {names}
        </Text>
        <Text style={styles.caption} numberOfLines={1}>
          First in your Deck
        </Text>
      </View>
    </Animated.View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
    paddingVertical: spacing.md - 2,
    paddingLeft: spacing.md - 2,
    paddingRight: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.backgroundMuted,
  },
  logos: {
    flexDirection: 'row',
  },
  // A ring in the card's own colour, so overlapping logos read as a stack, not a smear.
  logo: {
    borderRadius: radius.md + 2,
    borderWidth: 2,
    borderColor: colors.backgroundMuted,
  },
  logoOverlap: {
    marginLeft: -10,
  },
  text: {
    flex: 1,
    gap: 1,
  },
  names: {
    fontSize: fontSize.small + 1,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.1,
  },
  caption: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
  },
}));
