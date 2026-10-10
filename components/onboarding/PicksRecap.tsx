import { View } from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';

import { CompanyLogo } from '@/components/common/CompanyLogo';
import { radius, spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';
import { useOnboarding } from '@/context/OnboardingContext';
import { useCompanyDirectory } from '@/hooks/useCompanies';

/** Past this many the stack stops reading as a row of logos and starts reading as a wall. */
const MAX_LOGOS = 6;

/**
 * The companies just followed, as an overlapping row of logos under the sign-up title.
 *
 * It is what "Save your picks." refers to. Logos only, no line of counts: the companies
 * are the part of onboarding somebody recognises at a glance, and a sentence of numbers
 * under a title reads as a receipt.
 */
export function PicksRecap() {
  const styles = useStyles();
  const { followedCompanySlugs } = useOnboarding();
  const directory = useCompanyDirectory();

  const logos = followedCompanySlugs
    .map((slug) => directory.bySlug.get(slug))
    .filter((company) => company !== undefined)
    .slice(0, MAX_LOGOS);

  if (logos.length === 0) return null;

  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`Following ${logos.map((company) => company.name).join(', ')}`}>
      {logos.map((company, index) => (
        <Animated.View
          key={company.id}
          entering={ZoomIn.duration(240).delay(160 + index * 70)}
          style={[styles.logo, index > 0 ? styles.logoOverlap : null]}>
          <CompanyLogo logo={company.logo} name={company.name} color={company.logoColor} size="sm" />
        </Animated.View>
      ))}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  row: {
    flexDirection: 'row',
    marginTop: spacing.md,
  },
  // A ring in the page's own colour, so overlapping logos read as a stack, not a smear.
  logo: {
    borderRadius: radius.md + 2,
    borderWidth: 2,
    borderColor: colors.background,
  },
  logoOverlap: {
    marginLeft: -8,
  },
}));
