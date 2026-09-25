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

import { CommentPolicySheet } from '@/components/comments/CommentPolicySheet';
import { CommentRow } from '@/components/comments/CommentRow';
import { ReportSheet } from '@/components/comments/ReportSheet';
import { EmptyState } from '@/components/common/EmptyState';
import { IconButton } from '@/components/common/IconButton';
import { Skeleton } from '@/components/common/Skeleton';
import { CONTENT_POLICY_VERSION } from '@/constants/policy';
import { fontSize, minTapTarget, radius, screenPadding, spacing } from '@/constants/theme';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { reactionGifs } from '@/data/mockGifs';
import { useCommentActions, useCommentGate, useJobComments } from '@/hooks/useComments';
import { ServiceError, ServiceUnavailable } from '@/lib/service';
import type { CommentGate, Job, ReportReason } from '@/types';

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
  /**
   * What the banner calls them — a pseudonym, or "your comment". Not a name: there is no name to
   * hold here, which is the whole of README §3.8's contract.
   */
  authorLabel: string;
}

/**
 * The comment sheet behind a reel's comment action — a Reels-style thread list over the
 * card, with a GIF picker and a composer pinned to the bottom.
 *
 * Phase 3 made all of this real, and three parts of the design show up in this file.
 *
 * **The composer knows before you type.** `useCommentGate()` answers whether this account can
 * comment and why not, so an unverified reader sees a way to verify instead of a text box that
 * rejects them. §10's rules are enforced in the database; this is the same answer, in advance, so
 * nobody writes four hundred characters into a dead end.
 *
 * **Posting is a foreground write.** Every other action in the app is optimistic-and-queued
 * (`lib/outbox.ts`), and a comment deliberately is not: the classifier can refuse it, and the
 * person needs to hear that while they still have the text. So the row appears immediately marked
 * `pending`, and a failure puts the draft back in the box with the reason. PHASE3.md §5.
 *
 * **Replies load when a thread is opened.** The list holds roots; "View 3 replies" fetches. A
 * posting where one comment attracted a long argument otherwise makes opening this sheet download
 * the argument.
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
  const { isCommentLiked, toggleCommentLike } = useCareerDeck();
  const { threads, total, isLoading, hasMore, loadMore, openThread, openThreadIds, closeThread } =
    useJobComments(job?.id);
  const { gate, acceptPolicy } = useCommentGate();
  const { post, isPosting, remove, report } = useCommentActions(job?.id);

  const sheetHeight = windowHeight * SHEET_HEIGHT_RATIO;
  const maxSheetHeight = windowHeight * SHEET_MAX_RATIO;

  const inputRef = useRef<TextInput>(null);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const [gifOpen, setGifOpen] = useState(false);
  /** Set when the last attempt was refused. Cleared as soon as the draft changes. */
  const [postError, setPostError] = useState<string | null>(null);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [acceptingPolicy, setAcceptingPolicy] = useState(false);
  const [reporting, setReporting] = useState<{ id: string; handle: string } | null>(null);
  const [isReporting, setIsReporting] = useState(false);

  const translateY = useSharedValue(sheetHeight);
  const scrollY = useSharedValue(0);
  const keyboard = useAnimatedKeyboard();

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
    if (openThreadIds.has(commentId)) closeThread(commentId);
    else openThread(commentId);
  };

  const handleReplyTo = (parentId: string, handle: string, isYou: boolean, isNested: boolean) => {
    setReplyTo({ id: parentId, authorLabel: isYou ? 'your comment' : handle });
    // Answering someone inside a thread names them, the way a reply chain does — the
    // parent row is no longer directly above what you're writing.
    if (isNested && !isYou) setDraft((current) => (current.length > 0 ? current : `@${handle} `));
    openThread(parentId);
    setGifOpen(false);
    inputRef.current?.focus();
  };

  /**
   * Turns a refusal into a sentence the writer can act on.
   *
   * The service sends a short machine-readable code precisely so this does not have to match on
   * prose — and for `rejected` it also sends the classifier's own explanation, which names what to
   * change and is better than anything that could be written here.
   */
  const explain = (error: unknown): string => {
    if (error instanceof ServiceUnavailable) {
      return 'Commenting is not available on this build.';
    }
    if (error instanceof ServiceError) {
      switch (error.code) {
        case 'rejected':
          return error.message;
        case 'rate_limited':
          return 'You have posted a lot in the last hour. Try again later.';
        case 'not_verified':
          return 'Verify your account from your profile to comment.';
        case 'policy_not_accepted':
          return 'Have a quick read of the comment rules first.';
        case 'blocked':
          return 'This reply cannot be delivered.';
        case 'offline':
          return 'Could not reach CareerDeck. Your comment is still here — try again.';
        default:
          return error.message;
      }
    }
    return 'That did not send. Your comment is still here — try again.';
  };

  const submit = async (gifId?: string) => {
    if (!job) return;
    if (draft.trim().length === 0 && gifId === undefined) return;

    /*
     * The policy gate, checked here as well as by the database.
     *
     * The write path raises 428 for an unread policy, so this is not what makes it true — it is
     * what stops somebody losing a sentence to a round trip that could only ever have failed.
     */
    if (!gate.policyAccepted) {
      setPolicyOpen(true);
      return;
    }

    const body = draft;
    const parentId = replyTo?.id ?? null;

    // Cleared before the attempt, not after it: the draft belongs in the composer only while it
    // has not been accepted, and putting it back on failure is what the catch below does.
    setDraft('');
    setReplyTo(null);
    setGifOpen(false);
    setPostError(null);

    try {
      await post({ body, parentId, ...(gifId === undefined ? {} : { gifId }) });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      // A reply lands inside a thread, so open it — otherwise the writer's own reply is behind a
      // "View 1 reply" link and reads as having vanished.
      if (parentId !== null) openThread(parentId);
    } catch (error) {
      setDraft(body);
      if (parentId !== null && replyTo) setReplyTo(replyTo);
      setPostError(explain(error));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const handlePost = () => void submit();

  const handlePickGif = (gifId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    void submit(gifId);
  };

  const handleDelete = (commentId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    remove(commentId);
  };

  const handleToggleLike = (commentId: string) => {
    Haptics.selectionAsync();
    toggleCommentLike(commentId);
  };

  const handleAcceptPolicy = async () => {
    setAcceptingPolicy(true);
    try {
      await acceptPolicy(CONTENT_POLICY_VERSION);
      setPolicyOpen(false);
      inputRef.current?.focus();
    } catch {
      setPostError('Could not save that. Try again.');
      setPolicyOpen(false);
    } finally {
      setAcceptingPolicy(false);
    }
  };

  const handleReport = async (reason: ReportReason, detail: string | undefined, blockToo: boolean) => {
    if (!reporting) return;
    setIsReporting(true);
    try {
      await report({ commentId: reporting.id, reason, detail, blockToo });
      setReporting(null);
    } catch {
      setPostError('Could not send that report. Try again.');
      setReporting(null);
    } finally {
      setIsReporting(false);
    }
  };

  if (!job) return null;

  /*
   * The composer is shown to anybody who *could* comment, including somebody who has not read the
   * policy yet — tapping send opens the policy rather than being refused, which is one tap towards
   * commenting instead of a wall. It is hidden only when the account genuinely cannot: unverified,
   * muted, or banned.
   */
  const gateReason = reasonFor(gate);
  const canPost = draft.trim().length > 0 && !isPosting;

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
                {isLoading ? (
                  <View style={styles.loading}>
                    <Skeleton height={54} borderRadius={radius.lg} />
                    <Skeleton height={54} borderRadius={radius.lg} />
                    <Skeleton height={54} borderRadius={radius.lg} />
                  </View>
                ) : threads.length === 0 ? (
                  <EmptyState
                    icon="chatbubble-outline"
                    title="No comments yet"
                    message="Ask about the timeline, the interview, anything the posting leaves out."
                  />
                ) : (
                  threads.map(({ comment, replies, loadingReplies }) => {
                    const open = openThreadIds.has(comment.id);

                    return (
                      <Fragment key={comment.id}>
                        <CommentRow
                          comment={comment}
                          liked={isCommentLiked(comment.id)}
                          onDelete={comment.isYou ? () => handleDelete(comment.id) : undefined}
                          onReport={
                            comment.isYou
                              ? undefined
                              : () => setReporting({ id: comment.id, handle: comment.authorHandle })
                          }
                          onToggleLike={() => handleToggleLike(comment.id)}
                          onReply={() =>
                            handleReplyTo(comment.id, comment.authorHandle, comment.isYou, false)
                          }
                        />

                        {/* The count comes from the comment's own `replyCount`, not from how many
                            replies happen to be loaded — the link has to say "View 3 replies"
                            before any of them have been fetched. */}
                        {comment.replyCount > 0 ? (
                          <Pressable
                            onPress={() => toggleThread(comment.id)}
                            hitSlop={8}
                            accessibilityRole="button"
                            accessibilityState={{ expanded: open }}
                            accessibilityLabel={
                              open
                                ? 'Hide replies'
                                : `View ${comment.replyCount} ${comment.replyCount === 1 ? 'reply' : 'replies'}`
                            }
                            style={({ pressed }) => [styles.threadToggle, pressed ? styles.pressed : null]}>
                            <View style={styles.threadRule} />
                            <Text style={styles.threadToggleLabel}>
                              {open
                                ? loadingReplies
                                  ? 'Loading replies…'
                                  : 'Hide replies'
                                : `View ${comment.replyCount} ${comment.replyCount === 1 ? 'reply' : 'replies'}`}
                            </Text>
                          </Pressable>
                        ) : null}

                        {open
                          ? replies.map((reply) => (
                              <CommentRow
                                key={reply.id}
                                comment={reply}
                                isReply
                                liked={isCommentLiked(reply.id)}
                                onDelete={reply.isYou ? () => handleDelete(reply.id) : undefined}
                                onReport={
                                  reply.isYou
                                    ? undefined
                                    : () => setReporting({ id: reply.id, handle: reply.authorHandle })
                                }
                                onToggleLike={() => handleToggleLike(reply.id)}
                                // Attaches to the same parent rather than nesting a level
                                // deeper — see JobComment.
                                onReply={() =>
                                  handleReplyTo(comment.id, reply.authorHandle, reply.isYou, true)
                                }
                              />
                            ))
                          : null}
                      </Fragment>
                    );
                  })
                )}

                {/* A button rather than `onEndReached`: the sheet's list shares its pan with the
                    dismiss gesture, and a fetch that fires while somebody is dragging the sheet
                    closed is work nobody asked for. */}
                {hasMore ? (
                  <Pressable
                    onPress={loadMore}
                    accessibilityRole="button"
                    accessibilityLabel="Load older comments"
                    style={({ pressed }) => [styles.loadMore, pressed ? styles.pressed : null]}>
                    <Text style={styles.threadToggleLabel}>Older comments</Text>
                  </Pressable>
                ) : null}
              </Animated.ScrollView>
            </GestureDetector>

            <Animated.View style={[styles.composer, composerStyle]}>
              {/* Why you cannot write, when you cannot. Above the composer rather than replacing
                  it, so the thread stays readable — reading is most of what this sheet is for, and
                  an unverified reader is still a reader. */}
              {gateReason ? (
                <View style={styles.gateBanner}>
                  <Ionicons name="lock-closed-outline" size={14} color={colors.textTertiary} />
                  <Text style={styles.gateText}>{gateReason}</Text>
                </View>
              ) : null}

              {postError ? (
                <View style={styles.errorBanner}>
                  <Ionicons name="alert-circle-outline" size={14} color={colors.textOnBrand} />
                  <Text style={styles.errorText}>{postError}</Text>
                </View>
              ) : null}

              {replyTo ? (
                <View style={styles.replyBanner}>
                  <Text style={styles.replyBannerText} numberOfLines={1}>
                    Replying to {replyTo.authorLabel}
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
                  onChangeText={(text) => {
                    setDraft(text);
                    // The error described the previous attempt. Once the text changes it describes
                    // nothing, and leaving it up makes a fixed comment look still-broken.
                    if (postError !== null) setPostError(null);
                  }}
                  editable={gateReason === null}
                  placeholder={
                    gateReason === null
                      ? replyTo
                        ? 'Write a reply…'
                        : 'Add a comment…'
                      : 'Commenting is locked'
                  }
                  placeholderTextColor={colors.textTertiary}
                  style={styles.input}
                  multiline
                  maxLength={500}
                  accessibilityLabel={replyTo ? 'Write a reply' : 'Add a comment'}
                />

                <Pressable
                  onPress={() => setGifOpen((open) => !open)}
                  disabled={gateReason !== null}
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

      <CommentPolicySheet
        visible={policyOpen}
        busy={acceptingPolicy}
        onAccept={() => void handleAcceptPolicy()}
        onClose={() => setPolicyOpen(false)}
      />

      <ReportSheet
        visible={reporting !== null}
        authorHandle={reporting?.handle ?? ''}
        busy={isReporting}
        onSubmit={(reason, detail, blockToo) => void handleReport(reason, detail, blockToo)}
        onClose={() => setReporting(null)}
      />
    </Modal>
  );
}

/**
 * Why this account cannot comment, or null when it can.
 *
 * Mirrors what `post_comment()` enforces, in the order it enforces it, and says the *specific*
 * thing rather than "you cannot comment" — an unverified reader needs a route, a muted one needs a
 * date, and a rate-limited one needs to know it is temporary. An unread policy is deliberately not
 * in here: that one is one tap away and the send button handles it.
 */
function reasonFor(gate: CommentGate): string | null {
  if (gate.banned) return 'This account can no longer comment.';
  if (gate.mutedUntil !== null) {
    const until = new Date(gate.mutedUntil);
    return `You cannot comment until ${until.toLocaleDateString()}.`;
  }
  if (gate.tier !== 'edu' && gate.tier !== 'identity') {
    return 'Verify your account from your profile to join the conversation.';
  }
  if (gate.remainingHour <= 0) return 'You have posted a lot in the last hour. Try again later.';
  if (gate.remainingDay <= 0) return 'You have posted a lot today. Try again tomorrow.';
  return null;
}

const useStyles = makeStyles((colors) => ({
  loading: {
    gap: spacing.md,
    paddingTop: spacing.sm,
  },
  loadMore: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  gateBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.backgroundMuted,
  },
  gateText: {
    flex: 1,
    fontSize: fontSize.caption,
    lineHeight: 16,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.like,
  },
  errorText: {
    flex: 1,
    fontSize: fontSize.caption,
    lineHeight: 16,
    color: colors.textOnBrand,
    fontWeight: '600',
  },
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
