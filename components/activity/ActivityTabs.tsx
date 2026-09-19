import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { LayoutChangeEvent, Pressable, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, withSpring } from 'react-native-reanimated';

import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';

export type ActivityTab = 'applications' | 'saved' | 'liked' | 'following';

const TABS: { key: ActivityTab; label: string }[] = [
  { key: 'applications', label: 'Applications' },
  { key: 'saved', label: 'Saved' },
  { key: 'liked', label: 'Liked' },
  { key: 'following', label: 'Following' },
];

const PADDING = 4;
/** Travels further than a press spring, so it needs room to settle without overshooting visibly. */
const SLIDE_SPRING = { damping: 20, stiffness: 220, mass: 0.7 };

interface ActivityTabsProps {
  tab: ActivityTab;
  counts: Record<ActivityTab, number>;
  onChange: (tab: ActivityTab) => void;
}

/**
 * Activity's four lists. Same sliding-pill idiom as search's scope tabs, so switching
 * what you're looking at feels the same in both places — one object moving rather than
 * two backgrounds repainting.
 */
export function ActivityTabs({ tab, counts, onChange }: ActivityTabsProps) {
  const styles = useStyles();
  const [trackWidth, setTrackWidth] = useState(0);

  const activeIndex = TABS.findIndex((entry) => entry.key === tab);
  const slotWidth = trackWidth > 0 ? (trackWidth - PADDING * 2) / TABS.length : 0;

  const indicatorStyle = useAnimatedStyle(() => ({
    width: slotWidth,
    transform: [{ translateX: withSpring(activeIndex * slotWidth, SLIDE_SPRING) }],
  }));

  const handleLayout = (event: LayoutChangeEvent) => setTrackWidth(event.nativeEvent.layout.width);

  return (
    <View style={styles.track} onLayout={handleLayout}>
      {slotWidth > 0 ? <Animated.View style={[styles.indicator, indicatorStyle]} /> : null}

      {TABS.map((entry) => {
        const selected = entry.key === tab;
        return (
          <Pressable
            key={entry.key}
            onPress={() => {
              if (selected) return;
              Haptics.selectionAsync();
              onChange(entry.key);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={`${entry.label}, ${counts[entry.key]} items`}
            style={styles.tab}>
            <Text style={[styles.label, selected ? styles.labelActive : null]} numberOfLines={1}>
              {entry.label}
            </Text>
            <Text style={[styles.count, selected ? styles.countActive : null]}>{counts[entry.key]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  track: {
    flexDirection: 'row',
    padding: PADDING,
    borderRadius: radius.lg,
    backgroundColor: colors.backgroundMuted,
  },
  indicator: {
    position: 'absolute',
    top: PADDING,
    left: PADDING,
    bottom: PADDING,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    ...colors.shadowSoft,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    gap: 1,
    paddingVertical: spacing.sm,
  },
  label: {
    fontSize: fontSize.caption + 1,
    fontWeight: '600',
    color: colors.textTertiary,
  },
  labelActive: {
    color: colors.text,
    fontWeight: '700',
  },
  count: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    color: colors.textTertiary,
  },
  countActive: {
    color: colors.textSecondary,
  },
}));
