import { useState } from 'react';
import { LayoutChangeEvent, Pressable, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, withSpring } from 'react-native-reanimated';

import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';
import type { SearchScope } from '@/hooks/useSearch';

const SCOPES: { key: SearchScope; label: string }[] = [
  { key: 'jobs', label: 'Jobs' },
  { key: 'companies', label: 'Companies' },
];

/** Slightly softer than the press springs elsewhere — this travels further, so it needs room to settle. */
const SLIDE_SPRING = { damping: 20, stiffness: 220, mass: 0.7 };

interface SearchScopeTabsProps {
  scope: SearchScope;
  onChange: (scope: SearchScope) => void;
}

/**
 * Jobs / Companies segmented control. The selected pill is one absolutely-positioned
 * view that slides between slots rather than a background toggled per tab, so switching
 * scope reads as one object moving instead of two independently repainting.
 */
export function SearchScopeTabs({ scope, onChange }: SearchScopeTabsProps) {
  const styles = useStyles();
  const [trackWidth, setTrackWidth] = useState(0);

  const activeIndex = SCOPES.findIndex((entry) => entry.key === scope);
  const slotWidth = trackWidth > 0 ? (trackWidth - PADDING * 2) / SCOPES.length : 0;

  const indicatorStyle = useAnimatedStyle(() => ({
    width: slotWidth,
    transform: [{ translateX: withSpring(activeIndex * slotWidth, SLIDE_SPRING) }],
  }));

  const handleLayout = (event: LayoutChangeEvent) => setTrackWidth(event.nativeEvent.layout.width);

  return (
    <View style={styles.track} onLayout={handleLayout}>
      {slotWidth > 0 ? <Animated.View style={[styles.indicator, indicatorStyle]} /> : null}

      {SCOPES.map((entry) => {
        const selected = entry.key === scope;
        return (
          <Pressable
            key={entry.key}
            onPress={() => onChange(entry.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={`Search ${entry.label.toLowerCase()}`}
            style={styles.tab}>
            <Text style={[styles.label, selected ? styles.labelActive : null]}>{entry.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const PADDING = 4;

const useStyles = makeStyles((colors) => ({
  track: {
    flexDirection: 'row',
    padding: PADDING,
    borderRadius: radius.pill,
    backgroundColor: colors.backgroundMuted,
  },
  // Sits under the labels and matches a tab's box exactly, so the sliding pill lines up
  // with whichever label it lands on without either needing to know the other's size.
  indicator: {
    position: 'absolute',
    top: PADDING,
    left: PADDING,
    bottom: PADDING,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  label: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.textTertiary,
  },
  labelActive: {
    color: colors.text,
    fontWeight: '700',
  },
}));
