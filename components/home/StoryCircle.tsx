import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, Text, View } from 'react-native';

import { CompanyLogo } from '@/components/common/CompanyLogo';
import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import type { StoryGroup } from '@/types';

const AVATAR = 62;
/** White gap between the ring and the logo, the way Instagram insets its avatars. */
const RING_GAP = 3;
const RING_WIDTH = 2.5;

export const STORY_CIRCLE_WIDTH = AVATAR + (RING_GAP + RING_WIDTH) * 2;

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
 */
export function StoryCircle({ group, onPress }: StoryCircleProps) {
  const { colors } = useTheme();
  const styles = useStyles();

  const ringColor = group.hasUnseen ? group.logoColor ?? colors.accent : colors.border;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${group.name} stories, ${group.items.length} ${
        group.items.length === 1 ? 'update' : 'updates'
      }${group.hasUnseen ? '' : ', all watched'}`}
      style={({ pressed }) => [styles.container, pressed ? styles.pressed : null]}>
      <View
        style={[
          styles.ring,
          { borderColor: ringColor, borderWidth: group.hasUnseen ? RING_WIDTH : 1 },
        ]}>
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
      </View>

      <Text style={[styles.label, group.hasUnseen ? null : styles.labelSeen]} numberOfLines={1}>
        {group.name}
      </Text>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    width: STORY_CIRCLE_WIDTH,
    alignItems: 'center',
    gap: spacing.xs + 1,
  },
  pressed: {
    opacity: 0.7,
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
  labelSeen: {
    color: colors.textTertiary,
    fontWeight: '500',
  },
}));
