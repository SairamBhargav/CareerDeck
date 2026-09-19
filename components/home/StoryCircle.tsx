import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { CompanyLogo } from '@/components/common/CompanyLogo';
import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import type { StoryGroup } from '@/types';

const AVATAR = 62;
/** White gap between the ring and the logo, the way Instagram insets its avatars. */
const RING_GAP = 3;
const RING_WIDTH = 2.5;
const RING_WIDTH_SEEN = 1;

export const STORY_CIRCLE_WIDTH = AVATAR + (RING_GAP + RING_WIDTH) * 2;

/** Short and stiff — the ring should feel tapped, not thrown. */
const PRESS_SPRING = { damping: 16, stiffness: 400, mass: 0.4 };
/** How long the ring takes to fade and thin out once its last story is watched. */
const SEEN_MS = 320;

interface StoryCircleProps {
  group: StoryGroup;
  onPress: () => void;
}

/**
 * One company's ring in the stories row. An unwatched ring is drawn in that company's
 * own brand color — a stronger signal than Instagram's single gradient, since the color
 * already identifies who it belongs to. Once every story in the group has been watched
 * the ring drops back to a plain hairline border, so the row visibly empties out as you
 * work through it without anything shifting position.
 *
 * That drop is animated rather than snapped: the ring is the one thing on Home that
 * changes as a *result* of what you just did, and watching it fade is what connects the
 * two. Width and color both interpolate, so it thins and dims as one movement.
 */
export function StoryCircle({ group, onPress }: StoryCircleProps) {
  const { colors } = useTheme();
  const styles = useStyles();

  const brandColor = group.logoColor ?? colors.accent;

  // 1 while the group still has something unwatched, 0 once it doesn't.
  const unseen = useDerivedValue(
    () => withTiming(group.hasUnseen ? 1 : 0, { duration: SEEN_MS }),
    [group.hasUnseen],
  );
  const [pressed, setPressed] = useState(false);
  const scale = useDerivedValue(() => withSpring(pressed ? 0.93 : 1, PRESS_SPRING), [pressed]);

  const ringStyle = useAnimatedStyle(() => ({
    borderWidth: RING_WIDTH_SEEN + unseen.value * (RING_WIDTH - RING_WIDTH_SEEN),
    borderColor: interpolateColor(unseen.value, [0, 1], [colors.border, brandColor]),
    transform: [{ scale: scale.value }],
  }));

  const labelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(unseen.value, [0, 1], [colors.textTertiary, colors.text]),
  }));

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={`${group.name} stories, ${group.items.length} ${
        group.items.length === 1 ? 'update' : 'updates'
      }${group.hasUnseen ? '' : ', all watched'}`}
      style={styles.container}>
      <Animated.View style={[styles.ring, ringStyle]}>
        {group.isIndustry ? (
          <View style={styles.industryAvatar}>
            <Ionicons name="trending-up" size={26} color={colors.textInverse} />
          </View>
        ) : (
          <CompanyLogo
            logo={group.logo}
            name={group.name}
            color={group.logoColor}
            size="xl"
            shape="circle"
          />
        )}
      </Animated.View>

      <Animated.Text style={[styles.label, labelStyle]} numberOfLines={1}>
        {group.name}
      </Animated.Text>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    width: STORY_CIRCLE_WIDTH,
    alignItems: 'center',
    gap: spacing.xs + 1,
  },
  // A fixed box with the avatar centred inside, rather than padding around it: the ring
  // thins from 2.5px to 1px when a group is fully watched, and a fixed box means that
  // change doesn't nudge the logo by a pixel.
  ring: {
    width: STORY_CIRCLE_WIDTH,
    height: STORY_CIRCLE_WIDTH,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  industryAvatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.text,
  },
  label: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    color: colors.text,
    textAlign: 'center',
  },
}));
