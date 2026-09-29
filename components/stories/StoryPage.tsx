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
  /** Opens the publisher. The summary is ours; the article is theirs. */
  onReadSource: () => void;
  /** Undefined on industry stories, which have no company to follow. */
  isFollowing?: boolean;
  /** Closes the viewer and opens the company. Absent on industry stories. */
  onOpenCompany?: () => void;
  onToggleFollow?: () => void;
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
  onReadSource,
  isFollowing,
  onToggleFollow,
  onOpenCompany,
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
              <CompanyLogo logo={group.logo} name={group.name} color={group.logoColor} size="xl" />
            )}
          </View>

          <View style={[styles.caption, { paddingBottom: insets.bottom + spacing.xxl + spacing.xl }]}>
            <Text style={styles.tag} numberOfLines={1}>
              {item.tag}
            </Text>
            <Text style={styles.headline}>{item.headline}</Text>

            {/* The summary used to live behind "Read more", which left the page as a
                logo on a colour field. It is at most three sentences and it is the
                reason somebody opened the story, so it belongs on the story. */}
            {item.summary.length > 0 ? (
              item.summary.map((sentence, index) => (
                <Text key={index} style={styles.summary}>
                  {sentence}
                </Text>
              ))
            ) : (
              <Text style={styles.summary}>{item.subtext}</Text>
            )}

            {/* §9. Redisplaying a publisher’s article is infringement; the headline,
                our own summary and a link out are what keeps this lawful, so the
                attribution travels with the summary wherever the summary goes. */}
            <Text style={styles.attribution}>
              Summary by CareerDeck · {item.publisher}
            </Text>
          </View>
        </View>
      </GestureDetector>

      {/* box-none so only the close button captures touches — everything else in this
          strip falls through to the tap halves underneath. */}
      <View pointerEvents="box-none" style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <StoryProgressBar count={group.items.length} activeIndex={itemIndex} progress={progress} />

        <View style={styles.headerRow} pointerEvents="box-none">
          {/* The mark and the name are one target, because they are one thing: a tap on
              either is somebody asking who this company is. */}
          <Pressable
            onPress={onOpenCompany}
            disabled={!onOpenCompany}
            hitSlop={8}
            accessibilityRole={onOpenCompany ? 'link' : 'text'}
            accessibilityLabel={onOpenCompany ? 'Open ' + group.name : group.name}
            style={({ pressed }) => [styles.identity, pressed ? styles.pressed : null]}>
            <CompanyLogo logo={group.logo} name={group.name} color={group.logoColor} size="sm" />
            <View style={styles.identityText}>
              <Text style={styles.headerName} numberOfLines={1}>
                {group.name}
              </Text>
              <Text style={styles.headerTime}>{formatPostedAt(item.publishedAt)}</Text>
            </View>
          </Pressable>

          {/* Beside the name rather than down by the article link: following is about
              the company, and the company is what the top of the page is. */}
          {onToggleFollow && isFollowing === false ? (
            <Pressable
              onPress={onToggleFollow}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={'Follow ' + group.name}
              style={({ pressed }) => [styles.follow, pressed ? styles.pressed : null]}>
              <Ionicons name="add" size={13} color={INK} />
              <Text style={styles.followLabel}>Follow</Text>
            </Pressable>
          ) : null}

          <View style={styles.headerSpacer} />

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

      {/* A text link, not a button. It leaves the app, which is the least important
         thing anyone does here — the summary above is the point, and a filled pill
         competing with it said otherwise. */}
      <Pressable
        onPress={onReadSource}
        hitSlop={12}
        accessibilityRole="link"
        accessibilityLabel={'Read the full article at ' + item.publisher}
        style={({ pressed }) => [
          styles.source,
          { bottom: insets.bottom + spacing.lg },
          pressed ? styles.pressed : null,
        ]}>
        <Text style={styles.sourceLabel}>Read at {item.publisher}</Text>
        <Ionicons name="arrow-forward" size={12} color={INK_MUTED} />
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
    borderRadius: radius.xl,
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
  summary: {
    fontSize: fontSize.body,
    lineHeight: 22,
    color: INK_MUTED,
  },
  attribution: {
    marginTop: spacing.xs,
    fontSize: fontSize.caption,
    letterSpacing: 0.3,
    color: INK_MUTED,
    opacity: 0.8,
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
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 1,
  },
  identityText: {
    flexShrink: 1,
  },
  headerSpacer: {
    flex: 1,
  },
  follow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: INK_SURFACE,
  },
  followLabel: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    color: INK,
  },
  headerName: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: INK,
    flexShrink: 1,
  },
  headerTime: {
    fontSize: fontSize.small,
    color: INK_MUTED,
  },
  close: {
    padding: spacing.xs,
  },
  source: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    // No background and generous hit slop instead of padding: the target stays big
    // without a filled shape drawing the eye away from the summary.
    paddingVertical: spacing.xs,
  },
  sourceLabel: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: INK_MUTED,
    textDecorationLine: 'underline',
  },
  pressed: {
    opacity: 0.6,
  },
});
