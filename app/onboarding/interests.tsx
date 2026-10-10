import { useState } from 'react';
import { View } from 'react-native';

import { ScrollPane } from '@/components/common/ScrollPane';
import { InterestBubble } from '@/components/onboarding/InterestBubble';
import { OnboardingStep } from '@/components/onboarding/OnboardingStep';
import { INTERESTS, MIN_SECTORS } from '@/constants/industries';
import { spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';
import { useOnboarding } from '@/context/OnboardingContext';
import { useGuardedRouter } from '@/hooks/useGuardedRouter';

/**
 * Step two: what you are into, as a cloud of bubbles that drift in place.
 *
 * It replaced a forty-chip grid. The corpus is software and tech, the engineering
 * disciplines, and finance and business, so the list is the twenty-one fields inside
 * those three, with nothing outside them that would promise jobs the feed cannot show.
 *
 * The bubbles are ordinary pills, not circles. A circle sized to hold "Software
 * Engineering" is a circle that owns a quarter of the screen. Their motion is what makes
 * them bubbles: each one bobs on its own slow loop, so the cloud never sits still and
 * never moves enough to make a tap miss.
 *
 * The answer is stored as sector keys in `preferred_industries`, the same column the old
 * grid wrote, so the server needs only new `sector_families` rows (20261038000000) and
 * nothing that reads the column changes.
 */
export default function InterestsStep() {
  const router = useGuardedRouter();
  const styles = useStyles();
  const { industries, toggleIndustry } = useOnboarding();

  // A bubble only floats in on the screen's first mount. Coming back from the goal step
  // should find the cloud already there, not watch it assemble a second time.
  const [entered] = useState(() => industries.length === 0);

  const picked = industries.length;

  return (
    <OnboardingStep
      step={2}
      title={'What are\nyou into?'}
      subtitle="Tap your major, or anything you'd want to work on."
      canContinue={picked >= MIN_SECTORS}
      continueLabel={picked > 0 ? `Continue with ${picked}` : 'Tap a few'}
      onContinue={() => router.push('/onboarding/goal')}
      fills>
      <ScrollPane>
        <View style={styles.cloud}>
          {INTERESTS.map((interest, index) => (
            <InterestBubble
              key={interest.key}
              label={interest.label}
              index={index}
              selected={industries.includes(interest.key)}
              animateIn={entered}
              onPress={() => toggleIndustry(interest.key)}
            />
          ))}
        </View>
      </ScrollPane>
    </OnboardingStep>
  );
}

const useStyles = makeStyles(() => ({
  // Centred, and padded on every side, so the drift and the selected bubble's growth
  // never get clipped against the pane's edge.
  cloud: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    columnGap: spacing.sm + 2,
    rowGap: spacing.md + 2,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
  },
}));
