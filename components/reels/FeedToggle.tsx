import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, spacing } from '@/constants/theme';
import type { ReelFeed } from '@/hooks/useJobFeeds';

const TAB_WIDTH = 96;

const TABS: { key: ReelFeed; label: string }[] = [
  { key: 'following', label: 'Following' },
  { key: 'forYou', label: 'For You' },
];

interface FeedToggleProps {
  value: ReelFeed;
  onChange: (feed: ReelFeed) => void;
}

/** Centered Following / For You switch with an animated underline. */
export function FeedToggle({ value, onChange }: FeedToggleProps) {
  const activeIndex = TABS.findIndex((tab) => tab.key === value);
  const indicatorX = useRef(new Animated.Value(activeIndex * TAB_WIDTH)).current;

  useEffect(() => {
    Animated.spring(indicatorX, {
      toValue: activeIndex * TAB_WIDTH,
      useNativeDriver: true,
      speed: 18,
      bounciness: 4,
    }).start();
  }, [activeIndex, indicatorX]);

  return (
    <View style={styles.container} accessibilityRole="tablist">
      <View style={styles.tabs}>
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

        <Animated.View
          pointerEvents="none"
          style={[styles.indicator, { transform: [{ translateX: indicatorX }] }]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  tabs: {
    flexDirection: 'row',
  },
  tab: {
    width: TAB_WIDTH,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  label: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  labelActive: { color: colors.reelText },
  labelInactive: { color: colors.reelTextTertiary },
  indicator: {
    position: 'absolute',
    bottom: 0,
    left: TAB_WIDTH / 2 - 14,
    width: 28,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.reelText,
  },
});
