import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { Fragment, useEffect, useRef, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedKeyboard,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CommentRow } from '@/components/comments/CommentRow';
import { EmptyState } from '@/components/common/EmptyState';
import { IconButton } from '@/components/common/IconButton';
import { fontSize, minTapTarget, radius, screenPadding, spacing } from '@/constants/theme';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { reactionGifs } from '@/data/mockGifs';
import { useJobComments } from '@/hooks/useComments';
import type { Job } from '@/types';

/**
 * Fraction of the screen the sheet covers at rest. Deliberately short of full: the reel
 * stays on screen above it, so a comment still reads as being *about* something.
 */
const SHEET_HEIGHT_RATIO = 0.62;
/**
 * How far it is allowed to grow once the keyboard is up. Typing is when the thread
 * matters most — you're answering something — so the sheet climbs to make room to keep
 * reading rather than squeezing the list into the strip above the keys.
 */
const SHEET_MAX_RATIO = 0.9;
/** Drag past this, or flick faster than this, and it closes instead of springing back. */
const DISMISS_DISTANCE = 96;
const DISMISS_VELOCITY = 700;

const OPEN = { duration: 260, easing: Easing.out(Easing.cubic) };
const CLOSE = { duration: 200, easing: Easing.in(Easing.cubic) };

const GIF_COLUMNS = 4;
/** However tall the keyboard gets, leave at least this much thread on screen. */
const MIN_LIST_HEIGHT = 180;

interface CommentSheetProps {
  job: Job | null;
  visible: boolean;
  onClose: () => void;
}

/** Which comment the composer is currently answering, if any. */
interface ReplyTarget {
  id: string;
  authorName: string;
}

/**
 * The comment sheet behind a reel's comment action — a Reels-style thread list over the
 * card, with a GIF picker and a composer pinned to the bottom.
 *
 * Nothing here reaches a server: posting appends to the in-memory store, so a comment
 * survives until the app reloads. That's the same bargain every other interaction in
 * Milestone 0 makes.
 *
 * The caller keys this on the job id, so a new posting gets a new instance and the
 * composer starts empty — a half-typed reply aimed at a comment on a different job
 * would otherwise post into the wrong thread.
 */
export function CommentSheet({ job, visible, onClose }: CommentSheetProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { likedCommentIds, toggleCommentLike, addComment, deleteComment } = useCareerDeck();
  const { threads, total } = useJobComments(job?.id);

  const sheetHeight = windowHeight * SHEET_HEIGHT_RATIO;
  const maxSheetHeight = windowHeight * SHEET_MAX_RATIO;

  const inputRef = useRef<TextInput>(null);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const [gifOpen, setGifOpen] = useState(false);
  const [openThreads, setOpenThreads] = useState<Set<string>>(() => new Set<string>());

  const translateY = useSharedValue(sheetHeight);
  const scrollY = useSharedValue(0);
  const keyboard = useAnimatedKeyboard();
  const liked = new Set(likedCommentIds);

  // Slides up once, on mount — the parent unmounts this entirely when it closes.
  useEffect(() => {
    translateY.value = withTiming(0, OPEN);
  }, [translateY]);

  const dismiss = () => {
    translateY.value = withTiming(sheetHeight, CLOSE, (finished) => {
      'worklet';
      if (finished) runOnJS(onClose)();
    });
  };

  const scrollHandler = useAnimatedScrollHandler((event) => {
    'worklet';
    scrollY.value = event.contentOffset.y;
  });

  // Stands in for the list's own native pan so the two recognise simultaneously rather
  // than cancelling each other out.
  const listGesture = Gesture.Native();

  // Only claims downward drags, and only while the thread is already scrolled to the
  // top — dragging inside a scrolled list scrolls it instead of closing the sheet.
  const pan = Gesture.Pan()
    .activeOffsetY(8)
    .failOffsetY(-8)
    .simultaneousWithExternalGesture(listGesture)
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

  /**
   * The sheet grows with the keyboard instead of being shoved up by it. Its top edge
   * climbs alongside the keys until the whole panel covers `SHEET_MAX_RATIO`, and only
   * past that does the thread start giving back height — so on a normal phone you keep
   * roughly the reading room you had, with the composer sitting just above the keys.
   *
   * Tying the growth straight to `keyboard.height` rather than a separate animation is
   * what keeps the two in lockstep: there's no second timing curve to drift out of sync
   * with the system keyboard.
   */
  const sheetStyle = useAnimatedStyle(() => {
    const lift = keyboard.height.value;
    const extent = Math.min(maxSheetHeight, sheetHeight + lift);
    return {
      height: Math.max(extent - lift, MIN_LIST_HEIGHT),
      marginBottom: lift,
      transform: [{ translateY: translateY.value }],
    };
  });

  /**
   * The home-indicator inset is only needed while the keyboard is down. Once the keys
   * cover that strip, keeping it leaves a band of empty surface sitting above them.
   */
  const composerStyle = useAnimatedStyle(() => ({
    paddingBottom: Math.max(0, insets.bottom - keyboard.height.value) + spacing.sm,
  }));

  const toggleThread = (commentId: string) => {
    setOpenThreads((current) => {
      const next = new Set(current);
      if (next.has(commentId)) next.delete(commentId);
      else next.add(commentId);
      return next;
    });
  };

  const handleReplyTo = (parentId: string, authorName: string, isYou: boolean, isNested: boolean) => {
    setReplyTo({ id: parentId, authorName: isYou ? 'your comment' : authorName });
    // Answering someone inside a thread names them, the way a reply chain does — the
    // parent row is no longer directly above what you're writing.
    if (isNested && !isYou) setDraft((current) => (current.length > 0 ? current : `@${authorName} `));
    setOpenThreads((current) => new Set(current).add(parentId));
    setGifOpen(false);
    inputRef.current?.focus();
  };

  const handlePost = () => {
    if (!job || draft.trim().length === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    addComment(job.id, draft, replyTo?.id ?? null);
    setDraft('');
    setReplyTo(null);
  };

  const handlePickGif = (gifId: string) => {
    if (!job) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    addComment(job.id, draft, replyTo?.id ?? null, gifId);
    setDraft('');
    setReplyTo(null);
    setGifOpen(false);
  };

  const handleDelete = (commentId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    deleteComment(commentId);
  };

  const handleToggleLike = (commentId: string) => {
    Haptics.selectionAsync();
    toggleCommentLike(commentId);
  };

  if (!job) return null;

  const canPost = draft.trim().length > 0;

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={dismiss}>
      <Pressable style={styles.backdrop} onPress={dismiss} accessibilityLabel="Close comments" />

      <View style={styles.lift}>
        <GestureDetector gesture={pan}>
          <Animated.View style={[styles.sheet, sheetStyle]}>
            <View style={styles.grabberZone}>
              <View style={styles.grabber} />
            </View>

            {/* No job title here: the reel it belongs to is still on screen above the
                sheet, so restating it spends the widest line on something already known. */}
            <View style={styles.header}>
              <Text style={styles.title} accessibilityRole="header">
                {total === 1 ? '1 comment' : `${total} comments`}
              </Text>
              <IconButton name="close" accessibilityLabel="Close comments" onPress={dismiss} />
            </View>

            <GestureDetector gesture={listGesture}>
              <Animated.ScrollView
                onScroll={scrollHandler}
                scrollEventThrottle={16}
                contentContainerStyle={styles.list}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}>
                {threads.length === 0 ? (
                  <EmptyState
                    icon="chatbubble-outline"
                    title="No comments yet"
                    message="Ask about the timeline, the interview, anything the posting leaves out."
                  />
                ) : (
                  threads.map(({ comment, replies }) => {
                    const open = openThreads.has(comment.id);

                    return (
                      <Fragment key={comment.id}>
                        <CommentRow
                          comment={comment}
                          liked={liked.has(comment.id)}
                          onDelete={comment.isYou ? () => handleDelete(comment.id) : undefined}
                          onToggleLike={() => handleToggleLike(comment.id)}
                          onReply={() =>
                            handleReplyTo(comment.id, comment.authorName, comment.isYou, false)
                          }
                        />

                        {replies.length > 0 ? (
                          <Pressable
                            onPress={() => toggleThread(comment.id)}
                            hitSlop={8}
                            accessibilityRole="button"
                            accessibilityState={{ expanded: open }}
                            accessibilityLabel={
                              open
                                ? 'Hide replies'
                                : `View ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`
                            }
                            style={({ pressed }) => [styles.threadToggle, pressed ? styles.pressed : null]}>
                            <View style={styles.threadRule} />
                            <Text style={styles.threadToggleLabel}>
                              {open
                                ? 'Hide replies'
                                : `View ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}
                            </Text>
                          </Pressable>
                        ) : null}

                        {open
                          ? replies.map((reply) => (
                              <CommentRow
                                key={reply.id}
                                comment={reply}
                                isReply
                                liked={liked.has(reply.id)}
                                onDelete={reply.isYou ? () => handleDelete(reply.id) : undefined}
                                onToggleLike={() => handleToggleLike(reply.id)}
                                // Attaches to the same parent rather than nesting a level
                                // deeper — see JobComment.
                                onReply={() =>
                                  handleReplyTo(comment.id, reply.authorName, reply.isYou, true)
                                }
                              />
                            ))
                          : null}
                      </Fragment>
                    );
                  })
                )}
              </Animated.ScrollView>
            </GestureDetector>

            <Animated.View style={[styles.composer, composerStyle]}>
              {replyTo ? (
                <View style={styles.replyBanner}>
                  <Text style={styles.replyBannerText} numberOfLines={1}>
                    Replying to {replyTo.authorName}
                  </Text>
                  <Pressable
                    onPress={() => setReplyTo(null)}
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel reply">
                    <Ionicons name="close" size={14} color={colors.textTertiary} />
                  </Pressable>
                </View>
              ) : null}

              {gifOpen ? (
                <View style={styles.gifGrid}>
                  {reactionGifs.map((gif) => (
                    <Pressable
                      key={gif.id}
                      onPress={() => handlePickGif(gif.id)}
                      accessibilityRole="button"
                      accessibilityLabel={'Post the ' + gif.label + ' GIF'}
                      style={({ pressed }) => [styles.gifTile, pressed ? styles.pressed : null]}>
                      <Image source={gif.source} style={styles.gifImage} resizeMode="cover" />
                    </Pressable>
                  ))}
                </View>
              ) : null}

              <View style={styles.inputRow}>
                <TextInput
                  ref={inputRef}
                  value={draft}
                  onChangeText={setDraft}
                  placeholder={replyTo ? 'Write a reply…' : 'Add a comment…'}
                  placeholderTextColor={colors.textTertiary}
                  style={styles.input}
                  multiline
                  maxLength={500}
                  accessibilityLabel={replyTo ? 'Write a reply' : 'Add a comment'}
                />

                <Pressable
                  onPress={() => setGifOpen((open) => !open)}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: gifOpen }}
                  accessibilityLabel={gifOpen ? 'Hide GIFs' : 'Choose a GIF'}
                  style={({ pressed }) => [
                    styles.gifButton,
                    gifOpen ? styles.gifButtonOpen : null,
                    pressed ? styles.pressed : null,
                  ]}>
                  <Text style={[styles.gifButtonLabel, gifOpen ? styles.gifButtonLabelOpen : null]}>
                    GIF
                  </Text>
                </Pressable>

                <Pressable
                  onPress={handlePost}
                  disabled={!canPost}
                  accessibilityRole="button"
                  accessibilityLabel="Post comment"
                  accessibilityState={{ disabled: !canPost }}
                  style={({ pressed }) => [
                    styles.post,
                    canPost ? styles.postReady : styles.postIdle,
                    pressed && canPost ? styles.pressed : null,
                  ]}>
                  <Ionicons
                    name="arrow-up"
                    size={18}
                    color={canPost ? colors.accentText : colors.textTertiary}
                  />
                </Pressable>
              </View>
            </Animated.View>
          </Animated.View>
        </GestureDetector>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  // Holds the sheet at the bottom while the keyboard pushes it up.
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
  // A generous target around the grabber, since it's the obvious thing to grab.
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
  // The rule is what ties the link to the thread above it, the way a reply indent does.
  threadToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: 34 + spacing.md,
    paddingVertical: spacing.xs,
  },
  threadRule: {
    width: 22,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderStrong,
  },
  threadToggleLabel: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    color: colors.textTertiary,
  },
  // No rule above this: the composer is the same surface as the thread, and a hairline
  // there reads as a grey seam between the sheet and the keyboard.
  composer: {
    paddingHorizontal: screenPadding,
    paddingTop: spacing.sm,
    gap: spacing.sm,
    backgroundColor: colors.surface,
  },
  gifGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  gifTile: {
    width: `${100 / GIF_COLUMNS}%`,
    flexGrow: 1,
    flexBasis: `${100 / GIF_COLUMNS - 6}%`,
    aspectRatio: 4 / 3,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.backgroundMuted,
  },
  gifImage: {
    width: '100%',
    height: '100%',
  },
  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.backgroundMuted,
  },
  replyBannerText: {
    flex: 1,
    fontSize: fontSize.caption,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    minHeight: minTapTarget,
    maxHeight: 110,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderRadius: radius.xl,
    backgroundColor: colors.backgroundMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    color: colors.text,
    fontSize: fontSize.small,
    lineHeight: 19,
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
  gifButtonOpen: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  gifButtonLabel: {
    fontSize: fontSize.caption,
    fontWeight: '800',
    color: colors.textSecondary,
    letterSpacing: 0.3,
  },
  gifButtonLabelOpen: {
    color: colors.accentText,
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
  pressed: {
    opacity: 0.7,
  },
}));
