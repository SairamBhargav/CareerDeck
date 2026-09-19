import { useEffect, useCallback } from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CompanyLogo } from '@/components/common/CompanyLogo';
import { PrimaryButton } from '@/components/common/PrimaryButton';
import { fontSize, radius, screenPadding, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import type { Company, NewsItem } from '@/types';
import { formatPostedAt } from '@/utils/format';

/** Fraction of the screen the sheet covers when open. */
const SHEET_HEIGHT_RATIO = 0.86;
/**
 * Deliberately short thresholds: getting back to the story should cost a flick, not a
 * deliberate drag all the way down the screen. A nudge past this and it goes.
 */
const DISMISS_DISTANCE = 44;
const DISMISS_VELOCITY = 420;
/** Overscroll at the top of the article that counts as "scrolled down to leave". */
const OVERSCROLL_DISMISS = 26;

const OPEN = { duration: 280, easing: Easing.out(Easing.cubic) };
const CLOSE = { duration: 220, easing: Easing.in(Easing.cubic) };

interface StoryArticleSheetProps {
  item: NewsItem;
  company: Company | undefined;
  onClose: () => void;
  onToggleFollow: () => void;
}

/**
 * The "Read more" popup: the full article, over the story it came from. Reachable the
 * two ways the gesture implies — drag the sheet itself down, or scroll the article back
 * past its own top — plus a tap on the backdrop above it.
 */
export function StoryArticleSheet({ item, company, onClose, onToggleFollow }: StoryArticleSheetProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  const sheetHeight = windowHeight * SHEET_HEIGHT_RATIO;

  // Starts off-screen and slides up on mount; the parent only renders this while open.
  const translateY = useSharedValue(sheetHeight);
  const scrollY = useSharedValue(0);

  // Slides up once, on mount — the parent unmounts this entirely when it closes.
  useEffect(() => {
    translateY.value = withTiming(0, OPEN);
  }, [translateY]);

  const dismiss = useCallback(() => {
    translateY.value = withTiming(sheetHeight, CLOSE, (finished) => {
      'worklet';
      if (finished) runOnJS(onClose)();
    });
  }, [translateY, sheetHeight, onClose]);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      'worklet';
      scrollY.value = event.contentOffset.y;
    },
    onEndDrag: (event) => {
      'worklet';
      // Pulling the article back past its own top is the "scroll down to leave" exit.
      if (event.contentOffset.y < -OVERSCROLL_DISMISS) runOnJS(dismiss)();
    },
  });

  // Runs across the whole sheet, not just the grabber, so a flick down anywhere in the
  // article gets you back to the story. It recognises alongside the ScrollView rather
  // than fighting it, and only claims downward drags that start with the article already
  // at its top — dragging inside a scrolled article still just scrolls it.
  // Stands in for the ScrollView's own native pan so the two can be declared as
  // recognising simultaneously, rather than the sheet drag and the scroll cancelling
  // each other out.
  const scrollGesture = Gesture.Native();

  const pan = Gesture.Pan()
    .activeOffsetY(6)
    .failOffsetY(-6)
    .simultaneousWithExternalGesture(scrollGesture)
    .onUpdate((event) => {
      'worklet';
      if (scrollY.value <= 0) translateY.value = Math.max(0, event.translationY);
    })
    .onEnd((event) => {
      'worklet';
      if (translateY.value > DISMISS_DISTANCE || event.velocityY > DISMISS_VELOCITY) {
        runOnJS(dismiss)();
      } else {
        translateY.value = withTiming(0, OPEN);
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <View style={styles.overlay}>
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.sheet, { height: sheetHeight }, sheetStyle]}>
          <View style={styles.handleZone}>
            <View style={styles.grabber} />
          </View>

          <GestureDetector gesture={scrollGesture}>
            <Animated.ScrollView
              onScroll={scrollHandler}
              scrollEventThrottle={16}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxl }]}>
              <View style={styles.badgeRow}>
                {company ? (
                  <CompanyLogo logo={company.logo} name={company.name} color={company.logoColor} size="lg" />
                ) : null}
                <View style={styles.badgeText}>
                  <Text style={styles.tag}>{item.tag}</Text>
                  <Text style={styles.meta}>{formatPostedAt(item.publishedAt)}</Text>
                </View>
              </View>

              <Text style={styles.headline}>{item.headline}</Text>

              {item.body.map((paragraph, index) => (
                <Text key={index} style={styles.paragraph}>
                  {paragraph}
                </Text>
              ))}

              {company ? (
                <View style={styles.actions}>
                  <PrimaryButton
                    label={company.isFollowing ? 'Following' : `Follow ${company.name}`}
                    variant={company.isFollowing ? 'secondary' : 'primary'}
                    onPress={onToggleFollow}
                  />
                </View>
              ) : null}

              <Text style={[styles.hint, { color: colors.textTertiary }]}>Swipe down to go back</Text>
            </Animated.ScrollView>
          </GestureDetector>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    overflow: 'hidden',
    ...colors.shadowLifted,
  },
  handleZone: {
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    alignItems: 'center',
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
  },
  content: {
    paddingHorizontal: screenPadding,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  badgeText: {
    flex: 1,
    gap: 2,
  },
  tag: {
    fontSize: fontSize.small,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.textSecondary,
  },
  meta: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
  },
  headline: {
    fontSize: fontSize.display,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.6,
    lineHeight: 36,
    marginTop: spacing.sm,
  },
  paragraph: {
    fontSize: fontSize.body,
    lineHeight: 23,
    color: colors.textSecondary,
  },
  actions: {
    marginTop: spacing.lg,
  },
  hint: {
    fontSize: fontSize.caption,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
}));
