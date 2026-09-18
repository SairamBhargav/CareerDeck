import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

import { spacing } from '@/constants/theme';

/** Fixed ink for the pastel story backgrounds — see StoryViewer. */
const TRACK = 'rgba(17, 17, 20, 0.22)';
const FILL = '#111114';

interface StoryProgressBarProps {
  count: number;
  activeIndex: number;
  /** 0 to 1 across the active segment's hold time. */
  progress: SharedValue<number>;
}

/**
 * The segment bars across the top of a story: one per item in the group, filled for the
 * ones already passed, draining live on the current one, empty ahead.
 */
export function StoryProgressBar({ count, activeIndex, progress }: StoryProgressBarProps) {
  return (
    <View style={styles.row}>
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={styles.track}>
          {index < activeIndex ? <View style={styles.filled} /> : null}
          {index === activeIndex ? <ActiveSegment progress={progress} /> : null}
        </View>
      ))}
    </View>
  );
}

function ActiveSegment({ progress }: { progress: SharedValue<number> }) {
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: progress.value }],
  }));

  // scaleX from a left origin rather than an animated width: it runs on the UI thread
  // without laying the view out again on every frame.
  return <Animated.View style={[styles.filled, styles.active, animatedStyle]} />;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  track: {
    flex: 1,
    height: 2.5,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: TRACK,
  },
  filled: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 2,
    backgroundColor: FILL,
  },
  active: {
    transformOrigin: 'left',
  },
});
