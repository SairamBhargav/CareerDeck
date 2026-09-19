import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS, withTiming, type SharedValue } from 'react-native-reanimated';
import type { EdgeInsets } from 'react-native-safe-area-context';

import { CompanyLogo } from '@/components/common/CompanyLogo';
import { StoryProgressBar } from '@/components/stories/StoryProgressBar';
import { fontSize, radius, screenPadding, spacing } from '@/constants/theme';
import { useTheme } from '@/context/ThemeContext';
import type { StoryGroup } from '@/types';
import { formatPostedAt } from '@/utils/format';

/** Downward drag that closes the whole viewer. */
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 800;
/**
 * Horizontal slop before this page's own pan gives up and lets the deck underneath take
 * the gesture. Keeping it small means a sideways swipe reaches the pager almost at once.
 */
const HORIZONTAL_SLOP = 14;

/**
 * Story backgrounds are the news items' own pastel accents, which are light in every
 * case — so the ink on top is fixed rather than themed, the same call the news card made
 * for its accent block.
 */
const INK = '#111114';
const INK_MUTED = 'rgba(17, 17, 20, 0.62)';
const INK_SURFACE = 'rgba(255, 255, 255, 0.72)';

interface StoryPageProps {
  group: StoryGroup;
  itemIndex: number;
  /** One full screen wide — the deck pages on exactly this interval. */
  width: number;
  insets: EdgeInsets;
  /** Live on the active page; a parked zero on the neighbours either side. */
  progress: SharedValue<number>;
  /** The viewer's shared swipe-down offset, driven from here. */
  dragY: SharedValue<number>;
  onNext: () => void;
  onPrevious: () => void;
  onHoldChange: (held: boolean) => void;
  onClose: () => void;
  onReadMore: () => void;
}

/**
 * One company's page in the story deck. Owns the gestures that act *within* a company —
 * the tap halves, hold-to-pause, and the swipe-down dismiss — and deliberately fails on
 * horizontal movement so a sideways swipe falls through to the pager that carries you to
 * the next company instead.
 */
export function StoryPage({
  group,
  itemIndex,
  width,
  insets,
  progress,
  dragY,
  onNext,
  onPrevious,
  onHoldChange,
  onClose,
  onReadMore,
}: StoryPageProps) {
  const { colors } = useTheme();

  const item = group.items[itemIndex] ?? group.items[0];

  // Split the page down the middle: left half steps back, right half steps forward.
  const handleTap = (x: number) => {
    if (x < width / 2) onPrevious();
    else onNext();
  };

  const tap = Gesture.Tap()
    .maxDuration(250)
    .onEnd((event) => {
      'worklet';
      runOnJS(handleTap)(event.x);
    });

  const longPress = Gesture.LongPress()
    .minDuration(220)
    .maxDistance(24)
    .onStart(() => {
      'worklet';
      runOnJS(onHoldChange)(true);
    })
    .onFinalize(() => {
      'worklet';
      runOnJS(onHoldChange)(false);
    });

  const dismissPan = Gesture.Pan()
    .activeOffsetY(16)
    .failOffsetX([-HORIZONTAL_SLOP, HORIZONTAL_SLOP])
    .onUpdate((event) => {
      'worklet';
      dragY.value = Math.max(0, event.translationY);
    })
    .onEnd((event) => {
      'worklet';
      if (event.translationY > DISMISS_DISTANCE || event.velocityY > DISMISS_VELOCITY) {
        runOnJS(onClose)();
      }
      dragY.value = withTiming(0, { duration: 180 });
    });

  const gesture = Gesture.Race(dismissPan, Gesture.Exclusive(longPress, tap));

  if (!item) return null;

  return (
    <View style={[styles.page, { width, backgroundColor: item.accentColor }]}>
      <GestureDetector gesture={gesture}>
        <View style={styles.tapZone}>
          {/* Artwork stand-in: the company mark, large and centred on the article's own
              accent colour. */}
          <View style={styles.artwork}>
            {group.isIndustry ? (
              <View style={styles.industryMark}>
                <Ionicons name="trending-up" size={44} color={colors.textInverse} />
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

          <View style={[styles.caption, { paddingBottom: insets.bottom + spacing.xxl + spacing.xl }]}>
            <Text style={styles.tag} numberOfLines={1}>
              {item.tag}
            </Text>
            <Text style={styles.headline}>{item.headline}</Text>
            <Text style={styles.subtext}>{item.subtext}</Text>
          </View>
        </View>
      </GestureDetector>

      {/* box-none so only the close button captures touches — everything else in this
          strip falls through to the tap halves underneath. */}
      <View pointerEvents="box-none" style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <StoryProgressBar count={group.items.length} activeIndex={itemIndex} progress={progress} />

        <View style={styles.headerRow} pointerEvents="box-none">
          <CompanyLogo
            logo={group.logo}
            name={group.name}
            color={group.logoColor}
            size="sm"
            shape="circle"
          />
          <Text style={styles.headerName} numberOfLines={1}>
            {group.name}
          </Text>
          <Text style={styles.headerTime}>{formatPostedAt(item.publishedAt)}</Text>

          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Close stories"
            style={({ pressed }) => [styles.close, pressed ? styles.pressed : null]}>
            <Ionicons name="close" size={22} color={INK} />
          </Pressable>
        </View>
      </View>

      <Pressable
        onPress={onReadMore}
        accessibilityRole="button"
        accessibilityLabel={'Read the full article: ' + item.headline}
        style={({ pressed }) => [
          styles.readMore,
          { bottom: insets.bottom + spacing.lg },
          pressed ? styles.pressed : null,
        ]}>
        <Ionicons name="chevron-up" size={13} color={INK} />
        <Text style={styles.readMoreLabel}>Read more</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  tapZone: {
    flex: 1,
  },
  artwork: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  industryMark: {
    width: 96,
    height: 96,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: INK,
  },
  caption: {
    paddingHorizontal: screenPadding,
    gap: spacing.xs,
  },
  tag: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: INK_MUTED,
  },
  headline: {
    fontSize: fontSize.heading,
    fontWeight: '700',
    letterSpacing: -0.5,
    lineHeight: 28,
    color: INK,
  },
  subtext: {
    fontSize: fontSize.body,
    lineHeight: 21,
    color: INK_MUTED,
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: screenPadding,
    gap: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerName: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: INK,
    flexShrink: 1,
  },
  headerTime: {
    flex: 1,
    fontSize: fontSize.small,
    color: INK_MUTED,
  },
  close: {
    padding: spacing.xs,
  },
  readMore: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: INK_SURFACE,
  },
  readMoreLabel: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: INK,
  },
  pressed: {
    opacity: 0.6,
  },
});
