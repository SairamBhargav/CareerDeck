import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { Fragment, useEffect, useRef, useState } from 'react';
import {
  Image,
  Keyboard,
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
import { gifById } from '@/data/mockGifs';
import { useKlipyGif } from '@/hooks/useGifs';
import { authorLabel } from '@/types/comment';
import { CommentRow } from '@/components/comments/CommentRow';
import { GifPicker } from '@/components/comments/GifPicker';
import { ReportSheet } from '@/components/comments/ReportSheet';
import { EmptyState } from '@/components/common/EmptyState';
import { IconButton } from '@/components/common/IconButton';
import { Skeleton } from '@/components/common/Skeleton';
import { CONTENT_POLICY_VERSION } from '@/constants/policy';
import { fontSize, minTapTarget, radius, screenPadding, spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { useGuardedRouter } from '@/hooks/useGuardedRouter';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useCommentActions, useCommentGate, useJobComments } from '@/hooks/useComments';
import { klipySlugOf, reportGifShared } from '@/lib/klipy';
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

/**
 * Unsent text per posting, for as long as the app runs. Closing the sheet by a stray tap on the
 * backdrop or a swipe used to throw the draft away; now it is waiting when the sheet reopens.
 */
const drafts = new Map<string, string>();

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
   * What the banner calls them — their credential, or "your comment". Not a name: there is no
   * name to hold here, which is the whole of README §3.8's contract.
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
  const { userId } = useAuth();
  const { threads, total, isLoading, hasMore, loadMore, openThread, openThreadIds, closeThread } =
    useJobComments(job?.id);
  const router = useGuardedRouter();
  const { gate, acceptPolicy } = useCommentGate();
  const { post, remove, report } = useCommentActions(job?.id);

  const sheetHeight = windowHeight * SHEET_HEIGHT_RATIO;
  const maxSheetHeight = windowHeight * SHEET_MAX_RATIO;

  const inputRef = useRef<TextInput>(null);
  const [draft, setDraftState] = useState(() => (job ? (drafts.get(job.id) ?? '') : ''));
  const setDraft = (next: string | ((current: string) => string)) =>
    setDraftState((current) => {
      const value = typeof next === 'function' ? next(current) : next;
      if (job) {
        if (value.length > 0) drafts.set(job.id, value);
        else drafts.delete(job.id);
      }
      return value;
    });
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const [gifOpen, setGifOpen] = useState(false);
  /*
   * The GIF chosen but not yet sent.
   *
   * Picking one used to post it on the spot, which made the grid a send button: there was no way
   * to say anything alongside it and no way to change your mind. It is an attachment now, so the
   * flow is the one every other app has — pick, then write, then send.
   */
  const [pendingGif, setPendingGif] = useState<{ id: string; slug?: string } | null>(null);
  /** Set when the last attempt was refused. Cleared as soon as the draft changes. */
  const [postError, setPostError] = useState<string | null>(null);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [acceptingPolicy, setAcceptingPolicy] = useState(false);
  const [reporting, setReporting] = useState<{ id: string } | null>(null);
  const [isReporting, setIsReporting] = useState(false);

  const translateY = useSharedValue(sheetHeight);
  const scrollY = useSharedValue(0);
  const keyboard = useAnimatedKeyboard();

  // Slides up once, on mount — the parent unmounts this entirely when it closes.
  useEffect(() => {
    translateY.set(withTiming(0, OPEN));
  }, [translateY]);

  const dismiss = () => {
    translateY.set(withTiming(sheetHeight, CLOSE, (finished) => {
      'worklet';
      if (finished) runOnJS(onClose)();
    }));
  };

  const scrollHandler = useAnimatedScrollHandler((event) => {
    'worklet';
    scrollY.set(event.contentOffset.y);
  });

  /*
   * The GIF overlay drags down to go back, the same way the sheet itself drags down to close.
   *
   * Its own offset and its own scroll tracking, because the two gestures have to be able to
   * disagree: dragging the overlay away should not also be dragging the sheet shut, and the grid
   * underneath has a scroll position of its own that decides when the drag is allowed to start.
   */
  const gifTranslateY = useSharedValue(0);
  const gifScrollY = useSharedValue(0);

  const gifListGesture = Gesture.Native();

  /*
   * Whether the composer was focused when the picker opened, so leaving it can put things back.
   *
   * A ref and not state: nothing renders differently for it, and it is read inside the animation's
   * completion callback, where a stale closure over a state value would answer for whenever that
   * callback was built rather than for now.
   */
  const keyboardWasUp = useRef(false);

  /** Tracks the open→closed edge, so the effect below does not fire on mount. */
  const gifWasOpen = useRef(false);

  /*
   * Put the keyboard back the way it was, whichever way the picker was left.
   *
   * An effect on `gifOpen` rather than something `closeGif` does, because `closeGif` is reached
   * from inside the dismiss gesture's worklet — and a worklet built during render that transitively
   * reads a ref is what `react-hooks/refs` rejects, correctly. Closing is a state change; this is
   * a consequence of it, so it belongs here and covers the drag, the tap and the pick at once.
   */
  useEffect(() => {
    if (gifOpen) {
      gifWasOpen.current = true;
      return;
    }
    if (!gifWasOpen.current) return;
    gifWasOpen.current = false;

    if (keyboardWasUp.current) {
      // They were mid-sentence when they went looking for a GIF. Put the keys back.
      inputRef.current?.focus();
    } else {
      // They were not typing — but the picker's own search box may have raised the keyboard, and
      // that one belongs to the screen they are leaving.
      Keyboard.dismiss();
    }
  }, [gifOpen]);

  const closeGif = () => {
    gifTranslateY.set(withTiming(sheetHeight, CLOSE, (finished) => {
      'worklet';
      if (finished) runOnJS(setGifOpen)(false);
    }));
  };

  const openGif = () => {
    /*
     * The keyboard goes first.
     *
     * Browsing is not typing, and the grid wants exactly the height the keys were using — on a
     * normal phone that is most of the panel. The sheet is tied to `keyboard.height` (see
     * `sheetStyle`), so dismissing here is also what lets it settle back to its own size instead
     * of holding a keyboard-shaped gap behind a full-screen grid.
     *
     * Tapping a Pressable does not blur a focused TextInput on its own, so this has to be said.
     * Noted first, because `finishCloseGif` restores whatever was true here.
     */
    keyboardWasUp.current = inputRef.current?.isFocused() ?? false;
    Keyboard.dismiss();

    // Parked off the bottom first, so it does not appear already dragged away. The rise starts a
    // frame later, once the overlay is actually mounted — starting it here would animate through
    // frames that are not on screen yet.
    gifTranslateY.set(sheetHeight);
    setGifOpen(true);
    requestAnimationFrame(() => gifTranslateY.set(withTiming(0, OPEN)));
  };

  // Mirrors the sheet's pan: downward only, and only from the top of the grid, so dragging
  // through a scrolled grid scrolls it instead of throwing the picker away.
  const gifPan = Gesture.Pan()
    .activeOffsetY(10)
    .failOffsetY(-10)
    .simultaneousWithExternalGesture(gifListGesture)
    .onUpdate((event) => {
      'worklet';
      if (gifScrollY.value <= 0) gifTranslateY.set(Math.max(0, event.translationY));
    })
    .onEnd((event) => {
      'worklet';
      if (gifTranslateY.value > DISMISS_DISTANCE || event.velocityY > DISMISS_VELOCITY) {
        runOnJS(closeGif)();
      } else {
        gifTranslateY.set(withTiming(0, OPEN));
      }
    });

  const gifOverlayStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: gifTranslateY.value }],
  }));

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
      if (scrollY.value <= 0) translateY.set(Math.max(0, event.translationY));
    })
    .onEnd((event) => {
      'worklet';
      if (translateY.value > DISMISS_DISTANCE || event.velocityY > DISMISS_VELOCITY) {
        runOnJS(dismiss)();
      } else {
        translateY.set(withTiming(0, OPEN));
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

  /*
   * `label` is the credential being answered ("CS @ Purdue '27"). Replies inside a thread used to
   * pre-fill "@handle"; with no handles on screen (2026-10-10) there is nobody to @, and the
   * "Replying to" line above the composer already says who.
   */
  const handleReplyTo = (parentId: string, label: string, isYou: boolean) => {
    setReplyTo({ id: parentId, authorLabel: isYou ? 'your comment' : label });
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

  const submit = async () => {
    if (!job) return;
    if (draft.trim().length === 0 && pendingGif === null) return;

    const gifId = pendingGif?.id;
    const gifSlug = pendingGif?.slug;

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
    const attached = pendingGif;

    // Cleared before the attempt, not after it: the draft belongs in the composer only while it
    // has not been accepted, and putting it back on failure is what the catch below does.
    setDraft('');
    setReplyTo(null);
    setPendingGif(null);
    setGifOpen(false);
    setPostError(null);

    // A reply lands inside a thread, so open it — otherwise the writer's own reply is behind a
    // "View 1 reply" link and reads as having vanished. Opened before the post, because the
    // reply now appears (dimmed) the moment it is sent rather than when the server answers.
    if (parentId !== null) openThread(parentId);
    // The send itself is the moment worth confirming; the server's answer arrives seconds later.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      const { takenDown } = await post({ body, parentId, ...(gifId === undefined ? {} : { gifId }) });
      /*
       * KLIPY's share signal, moved here from the moment of picking.
       *
       * It tunes their trending, and "trending" should mean posted, not browsed — somebody who
       * opens the grid, taps three GIFs looking at them and sends none has not shared anything.
       */
      if (gifSlug !== undefined) reportGifShared(gifSlug, userId);
      if (takenDown) {
        // The comment already vanished from the thread; this says why, and Updates keeps a copy.
        setPostError('Your comment was flagged and taken down. A moderator will review it.');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }
    } catch (error) {
      setDraft(body);
      setPendingGif(attached);
      if (parentId !== null && replyTo) setReplyTo(replyTo);
      setPostError(explain(error));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const handlePost = () => void submit();

  const handlePickGif = (gifId: string, slug?: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPendingGif(slug === undefined ? { id: gifId } : { id: gifId, slug });
    /*
     * Back to the thread, with the GIF waiting in the composer.
     *
     * Out through the same door a drag uses, which also means the same keyboard rule: it comes
     * back for somebody who was typing before they went looking, and stays down for somebody who
     * was not. Attaching a GIF is not by itself a request to type.
     */
    closeGif();
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

  /*
   * Push, then close.
   *
   * This sheet is a native transparent Modal, so it draws above the navigator and a pushed
   * screen cannot appear over it. Closing first would drop the reader onto the Deck for a
   * beat before verification arrived; pushing first commits the route behind a sheet that
   * is still covering everything, and the slide-down reveals it.
   *
   * The story viewer hit the same wall and took the other way out — it became a route
   * (app/story.tsx) so the company sheet could rise over it without closing anything.
   * That is the better fix when the thing underneath should survive the trip, and the
   * wrong one here: somebody leaving to verify is done with this thread for now.
   */
  const openVerification = () => {
    router.push('/verify');
    requestAnimationFrame(dismiss);
  };
  // Not blocked while an earlier comment is still in flight: it is already on screen, and each
  // comment carries its own idempotency key (useCommentActions), so two sends stay two comments.
  const canPost = draft.trim().length > 0 || pendingGif !== null;

  return (
    <Modal visible={visible} animationType="none" transparent onRequestClose={dismiss}>
      <Pressable style={styles.backdrop} onPress={dismiss} accessibilityLabel="Close comments" />

      <View style={styles.lift}>
        <Animated.View style={[styles.sheet, sheetStyle]}>
          {/* The drag-to-close gesture covers the grabber, the header and the thread, and stops at
              the composer: a drag in the text box or the GIF grid is somebody typing or browsing,
              never a request to close. */}
          <GestureDetector gesture={pan}>
            <View style={styles.dragArea} collapsable={false}>
              <View style={styles.grabberZone}>
                <View style={styles.grabber} />
              </View>

              {/* No job title here: the reel it belongs to is still on screen above the
                  sheet, so restating it spends the widest line on something already known. */}
              <View style={styles.header}>
                {/*
                  * A count of nothing is worse than no count: the empty state below already
                  * says there are no comments, and "0 comments" spends the widest line in
                  * the sheet saying it a second time, in the one place a reader looks to
                  * find out whether it is worth scrolling.
                  *
                  * A spacer rather than nothing, because the title's `flex: 1` is what holds
                  * the close button against the right edge.
                  */}
                {total === 0 ? (
                  <View style={styles.titleSpacer} />
                ) : (
                  <Text style={styles.title} accessibilityRole="header">
                    {total === 1 ? '1 comment' : `${total} comments`}
                  </Text>
                )}
                <IconButton name="close" accessibilityLabel="Close comments" onPress={dismiss} />
              </View>

              <GestureDetector gesture={listGesture}>
                <Animated.ScrollView
                  onScroll={scrollHandler}
                  scrollEventThrottle={16}
                  contentContainerStyle={styles.list}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="on-drag"
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
                            onDelete={comment.isYou && !comment.pending ? () => handleDelete(comment.id) : undefined}
                            onReport={
                              comment.isYou
                                ? undefined
                                : () => setReporting({ id: comment.id })
                            }
                            onToggleLike={() => handleToggleLike(comment.id)}
                            onReply={() =>
                              handleReplyTo(comment.id, authorLabel(comment.authorBadge), comment.isYou)
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
                                  onDelete={reply.isYou && !reply.pending ? () => handleDelete(reply.id) : undefined}
                                  onReport={
                                    reply.isYou
                                      ? undefined
                                      : () => setReporting({ id: reply.id })
                                  }
                                  onToggleLike={() => handleToggleLike(reply.id)}
                                  // Attaches to the same parent rather than nesting a level
                                  // deeper — see JobComment.
                                  onReply={() =>
                                    handleReplyTo(comment.id, authorLabel(reply.authorBadge), reply.isYou)
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
            </View>
          </GestureDetector>

          <Animated.View style={[styles.composer, composerStyle]}>
            {/* Why you cannot write, when you cannot. Above the composer rather than replacing
                it, so the thread stays readable — reading is most of what this sheet is for, and
                an unverified reader is still a reader. */}
            {gateReason ? <GateBanner reason={gateReason} onVerify={openVerification} /> : null}

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

            {pendingGif ? (
              <StagedGif gifId={pendingGif.id} onRemove={() => setPendingGif(null)} />
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
                onPress={gifOpen ? closeGif : openGif}
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

          {/*
            * An overlay rather than a swap.
            *
            * The thread and the composer stay mounted underneath, so a reader who was forty
            * comments deep is still forty comments deep when they come back — rendering the grid
            * in their place would unmount the list and lose the scroll.
            *
            * It sits outside the drag gesture on purpose: the grid scrolls vertically, and a pan
            * that also claims downward drags would be fighting it for every flick. Close is the
            * button in the header.
            */}
          {gifOpen ? (
            <GestureDetector gesture={gifPan}>
              <Animated.View style={[styles.gifOverlay, gifOverlayStyle]}>
                {/*
                  * The grabber, and nothing else above the search box.
                  *
                  * There was a title and a close button here. The title said "Add a GIF" over a
                  * grid of GIFs and a box that says Search KLIPY, which is a caption for something
                  * already obvious, and the two of them cost a row of grid to say it.
                  *
                  * It is a Pressable as well as the drag handle, so the way out is not gesture-only
                  * — a tap closes, and screen readers get a real control where otherwise there
                  * would be none.
                  */}
                <Pressable
                  onPress={closeGif}
                  accessibilityRole="button"
                  accessibilityLabel="Close GIFs"
                  style={styles.grabberZone}>
                  <View style={styles.grabber} />
                </Pressable>

                {/*
                  * Exactly `screenPadding` each side, because that is the inset the picker assumes
                  * when it works out a tile width from the window. It lives here rather than on the
                  * overlay so the grabber above still spans the full width.
                  */}
                <View style={[styles.gifBody, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
                  <GifPicker
                    fill
                    onPick={handlePickGif}
                    scrollY={gifScrollY}
                    listGesture={gifListGesture}
                  />
                </View>
              </Animated.View>
            </GestureDetector>
          ) : null}
        </Animated.View>
      </View>

      <CommentPolicySheet
        visible={policyOpen}
        busy={acceptingPolicy}
        onAccept={() => void handleAcceptPolicy()}
        onClose={() => setPolicyOpen(false)}
      />

      <ReportSheet
        visible={reporting !== null}
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
/**
 * Why this account cannot write, and whether there is anything it can do about it.
 *
 * Only one of these is actionable. Being banned, muted or over the hourly limit is a
 * matter of waiting or of a decision already made elsewhere, and a button on those would
 * promise a way out that does not exist. Being unverified is a thing a reader can fix in
 * about a minute, so that one gets a door.
 */
function reasonFor(gate: CommentGate): { text: string; verify: boolean } | null {
  if (gate.banned) return { text: 'This account can no longer comment.', verify: false };
  if (gate.mutedUntil !== null) {
    const until = new Date(gate.mutedUntil);
    return { text: `You cannot comment until ${until.toLocaleDateString()}.`, verify: false };
  }
  if (gate.tier !== 'edu' && gate.tier !== 'identity') {
    // No longer "from your profile": it is from here now. No full stop either — this one
    // is the label of a button, not a sentence about the state of things.
    return { text: 'Verify your account to comment', verify: true };
  }
  if (gate.remainingHour <= 0) {
    return { text: 'You have posted a lot in the last hour. Try again later.', verify: false };
  }
  if (gate.remainingDay <= 0) {
    return { text: 'You have posted a lot today. Try again tomorrow.', verify: false };
  }
  return null;
}

interface GateBannerProps {
  reason: NonNullable<ReturnType<typeof reasonFor>>;
  onVerify: () => void;
}

/**
 * Why the composer is locked, as one row.
 *
 * This used to be a slab of text with the word "Verify" pinned to its right edge, which
 * read as two unrelated things sharing a grey rectangle — and the text wraps, so the word
 * ended up floating against the middle of two lines.
 *
 * So the whole row is the button now: lock, line, chevron. One target, one affordance, and
 * the copy is short enough to stay on one line at default type. When the reason is not
 * actionable the same row renders inert and loses the chevron, so nothing offers a tap that
 * would go nowhere.
 */
function GateBanner({ reason, onVerify }: GateBannerProps) {
  const { colors } = useTheme();
  const styles = useStyles();

  const body = (
    <Fragment>
      <Ionicons name="lock-closed" size={12} color={colors.textTertiary} />
      <Text style={styles.gateText}>{reason.text}</Text>
      {reason.verify ? (
        <Ionicons name="chevron-forward" size={15} color={colors.textTertiary} />
      ) : null}
    </Fragment>
  );

  if (!reason.verify) {
    return <View style={styles.gateBanner}>{body}</View>;
  }

  return (
    <Pressable
      onPress={onVerify}
      accessibilityRole="button"
      accessibilityLabel={reason.text}
      style={({ pressed }) => [styles.gateBanner, pressed ? styles.gateBannerPressed : null]}>
      {body}
    </Pressable>
  );
}

/** The height of the staged thumbnail. Small: it is a receipt, not the content. */
const STAGED_HEIGHT = 40;

/**
 * The GIF waiting in the composer, with a way to take it back.
 *
 * Resolved the same way CommentRow resolves a posted one — `gifById` for the bundled set,
 * `useKlipyGif` for a slug — so the thing shown here is the thing that will be sent, rather than
 * a second guess at it.
 */
function StagedGif({ gifId, onRemove }: { gifId: string; onRemove: () => void }) {
  const { colors } = useTheme();
  const styles = useStyles();

  const bundled = gifById(gifId);
  const klipy = useKlipyGif(klipySlugOf(gifId)).data ?? null;

  // 4:3 for the bundled set, which is what all eight are; its own shape for a KLIPY clip.
  const ratio = bundled ? 4 / 3 : klipy ? klipy.preview.width / klipy.preview.height : 1;
  const width = Math.min(80, Math.max(STAGED_HEIGHT, STAGED_HEIGHT * ratio));

  return (
    <View style={styles.staged}>
      {bundled || klipy ? (
        <Image
          source={bundled ? bundled.source : { uri: klipy?.preview.url ?? '' }}
          style={[styles.stagedThumb, { width }]}
          resizeMode="cover"
          accessible
          accessibilityRole="image"
          accessibilityLabel={`${bundled?.label ?? klipy?.title ?? 'The'} GIF, attached`}
        />
      ) : (
        // KLIPY has not answered yet, or this build has no key for it.
        <View style={[styles.stagedThumb, styles.stagedPending, { width }]} />
      )}

      <Text style={styles.stagedLabel}>GIF attached</Text>

      <Pressable
        onPress={onRemove}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Remove the GIF">
        <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
      </Pressable>
    </View>
  );
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
    // A deliberate row rather than one that hugs its text, and the floor a tappable one
    // needs anyway. Both variants take it, so the gate is the same height either way.
    minHeight: minTapTarget,
    borderRadius: radius.md,
    backgroundColor: colors.backgroundMuted,
  },
  gateBannerPressed: {
    opacity: 0.6,
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
    /*
     * Tighter than the `radius.xl` the app's other sheets use.
     *
     * A rounded top over a 45%-black backdrop cuts a wedge out of the white and fills it with the
     * dimmed screen, and at 26pt that wedge is big enough next to the bright sheet to read as a
     * smudge of shading rather than as background. 18 keeps the sheet reading as a sheet and takes
     * roughly a third off it.
     *
     * The other fifteen sheets still use 26 and have the same wedge; this is the one that was
     * noticed, not the only one.
     */
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    overflow: 'hidden',
  },
  dragArea: {
    flex: 1,
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
  titleSpacer: {
    flex: 1,
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
  // Fills the sheet, inside its rounded corners — `sheet` already clips with overflow: hidden.
  gifOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
  },
  gifBody: {
    flex: 1,
    paddingHorizontal: screenPadding,
    paddingTop: spacing.sm,
  },
  staged: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingRight: spacing.sm,
  },
  stagedThumb: {
    height: STAGED_HEIGHT,
    borderRadius: 8,
    backgroundColor: colors.backgroundMuted,
  },
  stagedPending: {
    opacity: 0.6,
  },
  stagedLabel: {
    flex: 1,
    fontSize: fontSize.caption,
    fontWeight: '600',
    color: colors.textTertiary,
  },
  composer: {
    paddingHorizontal: screenPadding,
    paddingTop: spacing.sm,
    gap: spacing.sm,
    backgroundColor: colors.surface,
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
