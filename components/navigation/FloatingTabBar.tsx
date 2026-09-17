import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
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
  fontSize,
  minTapTarget,
  radius,
  screenPadding,
  spacing,
  tabBarFloatGap,
  tabBarHeight,
} from '@/constants/theme';
import { useTabBarVisibility } from '@/context/TabBarVisibilityContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useTabBarHeight } from '@/hooks/useTabBarHeight';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

// expo-router's own MaterialTopTabBarProps types as `any & {...}`, which makes every
// field implicitly `any`. This mirrors the actual runtime shape TopTabs passes to a
// custom `tabBar` render (confirmed against its source) so this component stays typed.
export interface FloatingTabBarProps {
  state: {
    index: number;
    routes: { key: string; name: string }[];
  };
  descriptors: Record<string, { options: { title?: string } }>;
  navigation: {
    emit: (event: { type: string; target: string; canPreventDefault: true }) => { defaultPrevented: boolean };
    navigate: (routeName: string) => void;
  };
}

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
 * beneath the active tab whenever the user switches tabs. Always uses the darker blur
 * treatment (originally built for Reels' now-retired dark background) since that's the
 * look the app settled on for every tab, not just Reels.
 */
export function FloatingTabBar({ state, descriptors, navigation }: FloatingTabBarProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles();
  const { hiddenOffset } = useTabBarVisibility();
  const hideDistance = useTabBarHeight();

  const [rowWidth, setRowWidth] = useState(0);
  const tabWidth = rowWidth / state.routes.length;
  const indicatorX = useSharedValue(0);
  const hasMeasuredIndicator = useRef(false);
  const isFirstActiveTab = useRef(true);

  // Switching tabs always brings the bar back, matching the reference app's behavior,
  // and gives a light selection tick — this fires for a swipe between Home/Reels/Activity
  // just as much as a tap, since both land here as a state.index change. Skip the tick on
  // mount, since that's not a switch the user actually made.
  useEffect(() => {
    hiddenOffset.value = withTiming(0, { duration: 200 });
    if (isFirstActiveTab.current) {
      isFirstActiveTab.current = false;
    } else {
      Haptics.selectionAsync();
    }
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
          tint="systemChromeMaterialDark"
          blurMethod="dimezisBlurViewSdk31Plus"
          style={styles.pill}>
          <View style={styles.row} onLayout={handleRowLayout}>
            {rowWidth > 0 ? (
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.indicator,
                  { width: tabWidth - INDICATOR_INSET * 2, backgroundColor: colors.chromeSurface },
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

              const iconColor = focused ? colors.chromeText : colors.chromeTextMuted;

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
  const styles = useStyles();
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

const useStyles = makeStyles((colors) => ({
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
    ...colors.shadowLifted,
  },
  pill: {
    height: tabBarHeight,
    borderRadius: radius.pill,
    overflow: 'hidden',
    paddingHorizontal: spacing.xs,
    // Transparent in light, where the dark capsule separates itself against a white page.
    // In dark it needs a rim, or the blur dissolves into the background behind it.
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.chromeBorder,
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
}));
