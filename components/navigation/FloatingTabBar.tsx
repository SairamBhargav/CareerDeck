import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurView } from 'expo-blur';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
    Extrapolation,
    interpolate,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
    colors,
    fontSize,
    minTapTarget,
    radius,
    screenPadding,
    shadow,
    spacing,
    tabBarFloatGap,
    tabBarHeight,
} from '@/constants/theme';
import { useTabBarVisibility } from '@/context/TabBarVisibilityContext';
import { useTabBarHeight } from '@/hooks/useTabBarHeight';

import type { BottomTabBarProps } from 'expo-router/js-tabs';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const INDICATOR_INSET = 6;
const INDICATOR_SPRING = { damping: 18, stiffness: 220 };
const PRESS_SPRING = { damping: 12, stiffness: 200 };

function iconsForRoute(routeName: string): { active: IconName; inactive: IconName } {
  switch (routeName) {
    case 'reels':
      return { active: 'play-circle', inactive: 'play-circle-outline' };
    case 'activity':
      return { active: 'heart', inactive: 'heart-outline' };
    case 'index':
    default:
      return { active: 'home', inactive: 'home-outline' };
  }
}

/**
 * Instagram-style floating tab bar: a translucent, blurred capsule that hovers just
 * above the bottom edge instead of sitting flush against it. It hides on scroll-down
 * and reappears on scroll-up or near the top (driven by the shared `hiddenOffset` value
 * that scrolling screens set via useHideTabBarOnScroll), and a bubble highlight slides
 * beneath the active tab whenever the user switches tabs. Reels renders on a dark
 * immersive background, so the pill switches to a dark blur + light icon treatment while
 * that tab is active.
 */
export function FloatingTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { hiddenOffset } = useTabBarVisibility();
  const hideDistance = useTabBarHeight();

  const activeRouteName = state.routes[state.index]?.name;
  const isDarkContext = activeRouteName === 'reels';

  const [rowWidth, setRowWidth] = useState(0);
  const tabWidth = rowWidth / state.routes.length;
  const indicatorX = useSharedValue(0);
  const hasMeasuredIndicator = useRef(false);

  // Switching tabs always brings the bar back, matching the reference app's behavior.
  useEffect(() => {
    hiddenOffset.value = withTiming(0, { duration: 200 });
  }, [state.index, hiddenOffset]);

  // Slides the highlight bubble to the newly active tab. Jumps (no spring) the first time
  // the row is measured so it doesn't animate in from the left edge on mount.
  useEffect(() => {
    if (rowWidth === 0) return;
    const target = state.index * tabWidth + INDICATOR_INSET;
    if (!hasMeasuredIndicator.current) {
      indicatorX.value = target;
      hasMeasuredIndicator.current = true;
    } else {
      indicatorX.value = withSpring(target, INDICATOR_SPRING);
    }
  }, [state.index, rowWidth, tabWidth, indicatorX]);

  const handleRowLayout = (event: LayoutChangeEvent) => {
    setRowWidth(event.nativeEvent.layout.width);
  };

  const pillAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: hiddenOffset.value }],
    opacity: interpolate(hiddenOffset.value, [0, hideDistance], [1, 0], Extrapolation.CLAMP),
  }));

  const indicatorAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: indicatorX.value }],
  }));

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrapper, pillAnimatedStyle]}
      accessibilityRole="tablist">
      <View style={[styles.shadowWrap, { marginBottom: insets.bottom + tabBarFloatGap }]}>
        <BlurView
          intensity={78}
          tint={isDarkContext ? 'dark' : 'light'}
          blurMethod="dimezisBlurViewSdk31Plus"
          style={styles.pill}>
          <View style={styles.row} onLayout={handleRowLayout}>
            {rowWidth > 0 ? (
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.indicator,
                  {
                    width: tabWidth - INDICATOR_INSET * 2,
                    backgroundColor: isDarkContext ? colors.reelSurface : colors.backgroundMuted,
                  },
                  indicatorAnimatedStyle,
                ]}
              />
            ) : null}

            {state.routes.map((route, index) => {
              const options = descriptors[route.key]?.options ?? {};
              const focused = state.index === index;
              const icons = iconsForRoute(route.name);
              const label = typeof options.title === 'string' ? options.title : route.name;

              const onPress = () => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) {
                  navigation.navigate(route.name);
                }
              };

              const iconColor = focused
                ? isDarkContext
                  ? colors.reelText
                  : colors.text
                : isDarkContext
                  ? colors.reelTextTertiary
                  : colors.textTertiary;

              return (
                <TabBarButton
                  key={route.key}
                  focused={focused}
                  icon={focused ? icons.active : icons.inactive}
                  label={label}
                  iconColor={iconColor}
                  onPress={onPress}
                />
              );
            })}
          </View>
        </BlurView>
      </View>
    </Animated.View>
  );
}

interface TabBarButtonProps {
  focused: boolean;
  icon: IconName;
  label: string;
  iconColor: string;
  onPress: () => void;
}

/** A single tab: bounces with a spring whenever it becomes the active tab. */
function TabBarButton({ focused, icon, label, iconColor, onPress }: TabBarButtonProps) {
  const scale = useSharedValue(1);

  useEffect(() => {
    scale.value = withSpring(focused ? 1.08 : 1, PRESS_SPRING);
  }, [focused, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={`${label} tab`}
      style={({ pressed }) => [styles.tab, pressed ? styles.tabPressed : null]}>
      <Animated.View style={[styles.tabContent, animatedStyle]}>
        <Ionicons name={icon} size={24} color={iconColor} />
        <Text style={[styles.label, { color: iconColor }]} numberOfLines={1}>
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  shadowWrap: {
    marginHorizontal: screenPadding,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    ...shadow.lifted,
  },
  pill: {
    height: tabBarHeight,
    borderRadius: radius.pill,
    overflow: 'hidden',
    paddingHorizontal: spacing.xs,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  indicator: {
    position: 'absolute',
    top: 8,
    bottom: 8,
    borderRadius: radius.pill,
  },
  tab: {
    flex: 1,
    minHeight: minTapTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabPressed: {
    opacity: 0.7,
  },
  tabContent: {
    alignItems: 'center',
    gap: 2,
  },
  label: {
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
});
