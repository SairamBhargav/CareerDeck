import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  FadeInDown,
  LinearTransition,
  runOnJS,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CommentRow } from '@/components/comments/CommentRow';
import { IconButton } from '@/components/common/IconButton';
import { fontSize, minTapTarget, radius, screenPadding, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { PRACTICE_COMMENTS, PRACTICE_QUESTION } from '@/lib/tour';
import type { JobComment } from '@/types/comment';

/*
 * The real sheet's geometry and motion (components/comments/CommentSheet.tsx), copied rather
 * than imported because there they are private to a component wired to live data. Keep in step.
 */
const SHEET_HEIGHT_RATIO = 0.62;
const DISMISS_DISTANCE = 96;
const DISMISS_VELOCITY = 700;
const OPEN = { duration: 260, easing: Easing.out(Easing.cubic) };
const CLOSE = { duration: 200, easing: Easing.in(Easing.cubic) };

/** Long enough after opening that the reader has looked at the thread before anything moves. */
const TYPE_START_MS = 1600;
const TYPE_STEP_MS = 34;
/** The pause between the last letter and the send, like someone rereading their question. */
const SEND_AFTER_MS = 650;

type Phase = 'idle' | 'typing' | 'sending' | 'sent';

interface PracticeCommentSheetProps {
  /** Seeds the reader's own blob on the comment the demo posts. */
  seed: string;
  /** The reader's credential — what their posted comment is signed with. */
  credential: string;
  onDone: () => void;
}

/**
 * The tour's comments step: the app's comment sheet, with a practice thread in it.
 *
 * It replaced a short card of three comments that sprang up on a spring (2026-10-10, the user's
 * call): the tour should show the comment section people will actually use. So this is the real
 * sheet's frame — same slide, same header, same rows (`CommentRow` itself), same composer — over
 * eleven practice comments that scroll, and the hearts work.
 *
 * Then it shows posting rather than describing it: a question types itself into the composer,
 * the send button lights and presses, and the comment drops into the top of the thread signed
 * with the reader's own blob and credential. Nothing is sent anywhere. The reader closes the
 * sheet the way they would the real one: the X, or a drag down.
 */
export function PracticeCommentSheet({ seed, credential, onDone }: PracticeCommentSheetProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const sheetHeight = windowHeight * SHEET_HEIGHT_RATIO;

  const [liked, setLiked] = useState<Set<string>>(() => new Set());
  const [typed, setTyped] = useState(0);
  const [phase, setPhase] = useState<Phase>('idle');
  const [posted, setPosted] = useState<JobComment | null>(null);

  const translateY = useSharedValue(sheetHeight);
  const scrollY = useSharedValue(0);
  const sendScale = useSharedValue(1);
  const listRef = useAnimatedRef<Animated.ScrollView>();
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  // The moment the sheet opened, so "12m ago" stays put while the reader looks.
  const [openedAt] = useState(() => Date.now());
  const practice = useMemo<JobComment[]>(() => {
    return PRACTICE_COMMENTS.map((entry, index) => ({
      id: `tour-comment-${index}`,
      jobId: 'tour-nvidia',
      parentId: null,
      authorHandle: entry.handle,
      authorBadge: entry.badge,
      authorColor: '#111114',
      isYou: false,
      body: entry.body,
      ...(entry.gifId ? { gifId: entry.gifId } : {}),
      createdAt: new Date(openedAt - entry.minutesAgo * 60_000).toISOString(),
      editedAt: null,
      likeCount: entry.likes,
      replyCount: 0,
    }));
  }, [openedAt]);

  useEffect(() => {
    translateY.set(withTiming(0, OPEN));
  }, [translateY]);

  // The demo: wait, type, pause, press send, post. Every timer is cleared if the sheet closes.
  useEffect(() => {
    const later = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
    const typeFrom = (n: number) => {
      if (n > PRACTICE_QUESTION.length) {
        later(SEND_AFTER_MS, send);
        return;
      }
      setTyped(n);
      later(reduceMotion ? 0 : TYPE_STEP_MS, () => typeFrom(n + 1));
    };
    const send = () => {
      setPhase('sending');
      if (!reduceMotion) {
        sendScale.set(withSequence(withTiming(0.82, { duration: 110 }), withTiming(1, { duration: 160 })));
      }
      later(200, () => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setPosted({
          id: 'tour-comment-you',
          jobId: 'tour-nvidia',
          parentId: null,
          authorHandle: seed,
          authorBadge: credential,
          authorColor: '#111114',
          isYou: true,
          body: PRACTICE_QUESTION,
          createdAt: new Date().toISOString(),
          editedAt: null,
          likeCount: 0,
          replyCount: 0,
        });
        setTyped(0);
        setPhase('sent');
        listRef.current?.scrollTo({ y: 0, animated: true });
      });
    };

    later(TYPE_START_MS, () => {
      setPhase('typing');
      typeFrom(1);
    });
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, [credential, listRef, reduceMotion, seed, sendScale]);

  const dismiss = () => {
    translateY.set(
      withTiming(sheetHeight, CLOSE, (finished) => {
        'worklet';
        if (finished) runOnJS(onDone)();
      }),
    );
  };

  const scrollHandler = useAnimatedScrollHandler((event) => {
    'worklet';
    scrollY.set(event.contentOffset.y);
  });
  const listGesture = Gesture.Native();
  // Downward drags close the sheet, but only from the top of the thread — as in the real one.
  const pan = Gesture.Pan()
    .activeOffsetY(8)
    .failOffsetY(-8)
    .simultaneousWithExternalGesture(listGesture)
    .onUpdate((event) => {
      'worklet';
      if (scrollY.value <= 0) translateY.set(Math.max(0, event.translationY));
    })
    .onEnd((event) => {
      'worklet';
      if (translateY.value > DISMISS_DISTANCE || event.velocityY > DISMISS_VELOCITY) runOnJS(dismiss)();
      else translateY.set(withTiming(0, OPEN));
    });

  const sheetStyle = useAnimatedStyle(() => ({
    height: sheetHeight,
    transform: [{ translateY: translateY.value }],
  }));
  const sendStyle = useAnimatedStyle(() => ({ transform: [{ scale: sendScale.value }] }));

  const comments = posted ? [posted, ...practice] : practice;
  const draft = PRACTICE_QUESTION.slice(0, typed);
  const ready = draft.length > 0;

  const toggleLike = (id: string) =>
    setLiked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable style={styles.backdrop} onPress={dismiss} accessibilityLabel="Close comments" />

      <View style={styles.lift}>
        <Animated.View style={[styles.sheet, sheetStyle]}>
          <GestureDetector gesture={pan}>
            <View style={styles.dragArea} collapsable={false}>
              <View style={styles.grabberZone}>
                <View style={styles.grabber} />
              </View>

              <View style={styles.header}>
                <Text style={styles.title} accessibilityRole="header">
                  {comments.length} comments
                </Text>
                <IconButton name="close" accessibilityLabel="Close comments" onPress={dismiss} />
              </View>

              <GestureDetector gesture={listGesture}>
                <Animated.ScrollView
                  ref={listRef}
                  onScroll={scrollHandler}
                  scrollEventThrottle={16}
                  contentContainerStyle={styles.list}
                  showsVerticalScrollIndicator={false}>
                  {comments.map((comment) => (
                    <Animated.View
                      key={comment.id}
                      layout={reduceMotion ? undefined : LinearTransition.duration(260)}
                      entering={comment.isYou && !reduceMotion ? FadeInDown.duration(320) : undefined}>
                      <CommentRow
                        comment={{
                          ...comment,
                          likeCount: comment.likeCount + (liked.has(comment.id) ? 1 : 0),
                        }}
                        liked={liked.has(comment.id)}
                        onToggleLike={() => toggleLike(comment.id)}
                        onReply={() => undefined}
                      />
                    </Animated.View>
                  ))}
                </Animated.ScrollView>
              </GestureDetector>
            </View>
          </GestureDetector>

          {/* The real composer's look. It is not editable: it is where the demo types. */}
          <View style={[styles.composer, { paddingBottom: insets.bottom + spacing.sm }]}>
            <View style={styles.inputRow}>
              <View style={styles.input} accessible accessibilityLabel={ready ? draft : 'Add a comment'}>
                {ready ? (
                  <Text style={styles.inputText}>
                    {draft}
                    {/* Solid while letters arrive, as a real caret is mid-typing. */}
                    {phase === 'typing' ? <Text style={styles.caret}>|</Text> : null}
                  </Text>
                ) : (
                  <Text style={styles.placeholder}>Add a comment…</Text>
                )}
              </View>

              <View style={styles.gifButton}>
                <Text style={styles.gifButtonLabel}>GIF</Text>
              </View>

              <Animated.View
                style={[styles.post, ready || phase === 'sending' ? styles.postReady : styles.postIdle, sendStyle]}>
                <Ionicons
                  name="arrow-up"
                  size={18}
                  color={ready || phase === 'sending' ? colors.accentText : colors.textTertiary}
                />
              </Animated.View>
            </View>
          </View>
        </Animated.View>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  lift: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    overflow: 'hidden',
  },
  dragArea: {
    flex: 1,
  },
  grabberZone: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    alignItems: 'center',
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: screenPadding,
    paddingRight: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: {
    flex: 1,
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.3,
  },
  list: {
    paddingHorizontal: screenPadding,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  composer: {
    paddingHorizontal: screenPadding,
    paddingTop: spacing.sm,
    backgroundColor: colors.surface,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    minHeight: minTapTarget,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.xl,
    backgroundColor: colors.backgroundMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  inputText: {
    color: colors.text,
    fontSize: fontSize.small,
    lineHeight: 19,
  },
  placeholder: {
    color: colors.textTertiary,
    fontSize: fontSize.small,
    lineHeight: 19,
  },
  caret: {
    color: colors.text,
    fontWeight: '300',
  },
  gifButton: {
    height: 38,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    marginBottom: 3,
  },
  gifButtonLabel: {
    fontSize: fontSize.caption,
    fontWeight: '800',
    color: colors.textSecondary,
    letterSpacing: 0.3,
  },
  post: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 3,
  },
  postReady: {
    backgroundColor: colors.accent,
  },
  postIdle: {
    backgroundColor: colors.backgroundMuted,
  },
}));
