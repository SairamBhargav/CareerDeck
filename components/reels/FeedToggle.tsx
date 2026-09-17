import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';
import type { ReelFeed } from '@/hooks/useJobFeeds';

const TAB_WIDTH = 100;
const TRACK_PADDING = 4;
const SPRING = { damping: 16, stiffness: 220 };

const TABS: { key: ReelFeed; label: string }[] = [
  { key: 'following', label: 'Following' },
  { key: 'forYou', label: 'For You' },
];

interface FeedToggleProps {
  value: ReelFeed;
  onChange: (feed: ReelFeed) => void;
}

/** Following / For You switch: a segmented-control pill that springs to whichever is selected. */
export function FeedToggle({ value, onChange }: FeedToggleProps) {
  const styles = useStyles();
  const activeIndex = TABS.findIndex((tab) => tab.key === value);
  const pillX = useSharedValue(activeIndex * TAB_WIDTH);

  useEffect(() => {
    pillX.value = withSpring(activeIndex * TAB_WIDTH, SPRING);
  }, [activeIndex, pillX]);

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pillX.value }],
  }));

  return (
    <View style={styles.track} accessibilityRole="tablist">
      <Animated.View style={[styles.pill, { width: TAB_WIDTH - TRACK_PADDING * 2 }, pillStyle]} />

      {TABS.map((tab) => {
        const selected = tab.key === value;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={`${tab.label} feed`}
            style={styles.tab}>
            <Text style={[styles.label, selected ? styles.labelActive : styles.labelInactive]}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  track: {
    flexDirection: 'row',
    backgroundColor: colors.backgroundMuted,
    borderRadius: radius.pill,
    padding: TRACK_PADDING,
  },
  pill: {
    position: 'absolute',
    top: TRACK_PADDING,
    left: TRACK_PADDING,
    bottom: TRACK_PADDING,
    borderRadius: radius.pill,
    // Not `surface`: in dark that matches the track exactly and the selection vanishes.
    backgroundColor: colors.controlSurface,
    ...colors.shadowSoft,
  },
  tab: {
    width: TAB_WIDTH,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  label: {
    fontSize: fontSize.small,
    fontWeight: '600',
  },
  labelActive: { color: colors.text, fontWeight: '700' },
  labelInactive: { color: colors.textTertiary },
}));
