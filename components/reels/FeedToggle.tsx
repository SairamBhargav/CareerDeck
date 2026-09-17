import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { fontSize, spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';
import type { ReelFeed } from '@/hooks/useJobFeeds';

/**
 * Deliberately a timing curve, not a spring: the bottom tab bar's indicator is allowed
 * to overshoot and settle, but up here the same bounce reads as jello.
 */
const FADE = { duration: 180, easing: Easing.out(Easing.cubic) };

/** How far back the unselected word sits — dimmed, not hidden. */
const INACTIVE_OPACITY = 0.45;

const TABS: { key: ReelFeed; label: string }[] = [
  { key: 'following', label: 'Following' },
  { key: 'forYou', label: 'For You' },
];

interface FeedToggleProps {
  value: ReelFeed;
  onChange: (feed: ReelFeed) => void;
}

/**
 * Following / For You as bare words at the top of the feed, the way Reels and TikTok do
 * it — no track, no pill, no sliding indicator. The selected feed is simply the one that
 * reads louder: full weight and full opacity against a dimmed sibling.
 */
export function FeedToggle({ value, onChange }: FeedToggleProps) {
  const styles = useStyles();

  return (
    <View style={styles.row} accessibilityRole="tablist">
      {TABS.map((tab, index) => (
        <View key={tab.key} style={styles.item}>
          {index > 0 ? <View style={styles.divider} /> : null}
          <FeedTab label={tab.label} selected={tab.key === value} onPress={() => onChange(tab.key)} />
        </View>
      ))}
    </View>
  );
}

interface FeedTabProps {
  label: string;
  selected: boolean;
  onPress: () => void;
}

function FeedTab({ label, selected, onPress }: FeedTabProps) {
  const styles = useStyles();
  const emphasis = useSharedValue(selected ? 1 : 0);

  useEffect(() => {
    emphasis.value = withTiming(selected ? 1 : 0, FADE);
  }, [selected, emphasis]);

  // Opacity rather than two colours: it crossfades cleanly and stays legible over both
  // the light shell and a dark, company-tinted reel.
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: INACTIVE_OPACITY + emphasis.value * (1 - INACTIVE_OPACITY),
  }));

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label} feed`}
      hitSlop={8}
      style={({ pressed }) => [styles.tab, pressed ? styles.pressed : null]}>
      <Animated.Text style={[styles.label, selected ? styles.labelSelected : null, animatedStyle]}>
        {label}
      </Animated.Text>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  divider: {
    width: 1,
    height: 13,
    borderRadius: 1,
    marginHorizontal: spacing.md,
    backgroundColor: colors.textTertiary,
    opacity: 0.4,
  },
  tab: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  pressed: {
    opacity: 0.6,
  },
  label: {
    fontSize: fontSize.title,
    fontWeight: '600',
    letterSpacing: -0.2,
    color: colors.text,
  },
  labelSelected: {
    fontWeight: '700',
  },
}));
