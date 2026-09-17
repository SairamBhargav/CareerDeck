import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurView } from 'expo-blur';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fontSize, minTapTarget, tabBarHeight } from '@/constants/theme';
import { useTabBarVisibility } from '@/context/TabBarVisibilityContext';

import type { BottomTabBarProps } from 'expo-router/js-tabs';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

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
 * Instagram-style floating tab bar: translucent/blurred, absolutely positioned over
 * screen content, and hidden or shown by the shared `hiddenOffset` value that scrolling
 * screens drive via useHideTabBarOnScroll. Reels renders on a dark immersive background,
 * so the bar switches to a dark blur + light icon treatment while that tab is active.
 */
export function FloatingTabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { hiddenOffset } = useTabBarVisibility();

  const activeRouteName = state.routes[state.index]?.name;
  const isDarkContext = activeRouteName === 'reels';

  // Switching tabs always brings the bar back, matching the reference app's behavior.
  useEffect(() => {
    hiddenOffset.value = withTiming(0, { duration: 200 });
  }, [state.index, hiddenOffset]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: hiddenOffset.value }],
  }));

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrapper, animatedStyle]}
      accessibilityRole="tablist">
      <BlurView
        intensity={78}
        tint={isDarkContext ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
        blurMethod="dimezisBlurViewSdk31Plus"
        style={[
          styles.blur,
          { paddingBottom: insets.bottom, borderTopColor: isDarkContext ? colors.reelBorder : colors.border },
        ]}>
        <View style={styles.row}>
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
              <Pressable
                key={route.key}
                onPress={onPress}
                accessibilityRole="tab"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={`${label} tab`}
                style={styles.tab}>
                <Ionicons name={focused ? icons.active : icons.inactive} size={25} color={iconColor} />
                <Text style={[styles.label, { color: iconColor }]} numberOfLines={1}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </BlurView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  blur: {
    borderTopWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    height: tabBarHeight,
  },
  tab: {
    flex: 1,
    minHeight: minTapTarget,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  label: {
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
});
