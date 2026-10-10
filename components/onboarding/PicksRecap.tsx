import { Text, View } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';

import { CompanyLogo } from '@/components/common/CompanyLogo';
import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';
import { useOnboarding } from '@/context/OnboardingContext';
import { useCompanyDirectory } from '@/hooks/useCompanies';

/** Logos past this many would only crowd the strip; the count says the rest. */
const MAX_LOGOS = 4;

/**
 * What the four steps collected, as one line on the sign-up screen: the companies just
 * followed, and "3 interests · 7 a week · 2 following".
 *
 * It is what "Save your picks." refers to. Without it the title points at something the
 * screen does not show, and the email field reads as a gate rather than a save button.
 */
export function PicksRecap() {
  const styles = useStyles();
  const { industries, weeklyGoal, followedCompanySlugs } = useOnboarding();
  const directory = useCompanyDirectory();

  if (industries.length === 0 && followedCompanySlugs.length === 0) return null;

  const logos = followedCompanySlugs
    .map((slug) => directory.bySlug.get(slug))
    .filter((company) => company !== undefined)
    .slice(0, MAX_LOGOS);

  const parts = [
    `${industries.length} ${industries.length === 1 ? 'interest' : 'interests'}`,
    `${weeklyGoal} a week`,
    ...(followedCompanySlugs.length > 0 ? [`${followedCompanySlugs.length} following`] : []),
  ];

  return (
    <Animated.View entering={FadeIn.duration(320).delay(120)} style={styles.strip}>
      {logos.length > 0 ? (
        <View style={styles.logos}>
          {logos.map((company, index) => (
            <Animated.View
              key={company.id}
              entering={ZoomIn.delay(200 + index * 70).springify().damping(13)}
              style={[styles.logo, index > 0 ? styles.logoOverlap : null]}>
              <CompanyLogo logo={company.logo} name={company.name} color={company.logoColor} size="sm" />
            </Animated.View>
          ))}
        </View>
      ) : null}
      <Text style={styles.text} numberOfLines={1}>
        {parts.join(' · ')}
      </Text>
    </Animated.View>
  );
}

const useStyles = makeStyles((colors) => ({
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.md - 2,
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.backgroundMuted,
  },
  logos: {
    flexDirection: 'row',
  },
  // A ring in the strip's own colour, so overlapping logos read as a stack, not a smear.
  logo: {
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.backgroundMuted,
  },
  logoOverlap: {
    marginLeft: -10,
  },
  text: {
    flexShrink: 1,
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.textSecondary,
  },
}));
