import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
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
/** Gap between the ring and the logo plate, the way Instagram insets its avatars. */
const RING_GAP = 3;
const RING_WIDTH = 2.5;
const RING_WIDTH_SEEN = 1;
const INSET = RING_GAP + RING_WIDTH;

export const STORY_TILE_SIZE = AVATAR + INSET * 2;

/**
 * The ring's corner radius, derived from the logo plate's rather than picked: two
 * rounded squares only look like one object when the outer corner is the inner corner
 * plus the gap between them. Hardcoding a token here would make the ring's curve run
 * visibly tighter or looser than the logo's inside it.
 */
const TILE_RADIUS = radius.lg + INSET;

/** Short and stiff — the tile should feel tapped, not thrown. */
const PRESS_SPRING = { damping: 16, stiffness: 400, mass: 0.4 };
/** How long the ring takes to fade and thin out once its last story is watched. */
const SEEN_MS = 320;

interface StoryTileProps {
  group: StoryGroup;
  onPress: () => void;
}

/**
 * One company's tile in the stories row. An unwatched ring is drawn in that company's
 * own brand color — a stronger signal than Instagram's single gradient, since the color
 * already identifies who it belongs to. Once every story in the group has been watched
 * the ring drops back to a plain hairline border, so the row visibly empties out as you
 * work through it without anything shifting position.
 *
 * That drop is animated rather than snapped: the ring is the one thing on Home that
 * changes as a *result* of what you just did, and watching it fade is what connects the
 * two. Width and color both interpolate, so it thins and dims as one movement.
 */
export function StoryTile({ group, onPress }: StoryTileProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [pressed, setPressed] = useState(false);

  const brandColor = group.logoColor ?? colors.accent;

  // 1 while the group still has something unwatched, 0 once it doesn't.
  const unseen = useDerivedValue(
    () => withTiming(group.hasUnseen ? 1 : 0, { duration: SEEN_MS }),
    [group.hasUnseen],
  );
  // Derived from state rather than written to from the press handlers: the spring still
  // runs on the UI thread, but nothing mutates a shared value from JS.
  const scale = useDerivedValue(() => withSpring(pressed ? 0.93 : 1, PRESS_SPRING), [pressed]);

  const ringStyle = useAnimatedStyle(() => ({
    borderWidth: RING_WIDTH_SEEN + unseen.value * (RING_WIDTH - RING_WIDTH_SEEN),
    borderColor: interpolateColor(unseen.value, [0, 1], [colors.border, brandColor]),
    transform: [{ scale: scale.value }],
  }));

  const labelStyle = useAnimatedStyle(() => ({
    color: interpolateColor(unseen.value, [0, 1], [colors.textTertiary, colors.text]),
  }));

  // Opening a story takes over the whole screen, so the tap gets a light confirmation
  // that something is about to happen. Fired here rather than by the screen so every
  // caller gets it without having to remember.
  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  return (
    <Pressable
      onPress={handlePress}
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
          <CompanyLogo logo={group.logo} name={group.name} color={group.logoColor} size="xl" />
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
    width: STORY_TILE_SIZE,
    alignItems: 'center',
    gap: spacing.xs + 1,
  },
  // A fixed box with the logo centred inside, rather than padding around it: the ring
  // thins from 2.5px to 1px when a group is fully watched, and a fixed box means that
  // change doesn't nudge the logo by a pixel.
  ring: {
    width: STORY_TILE_SIZE,
    height: STORY_TILE_SIZE,
    borderRadius: TILE_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
  },
  industryAvatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: radius.lg,
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
