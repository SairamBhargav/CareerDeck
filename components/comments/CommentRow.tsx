import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { fontSize, radius, spacing } from '@/constants/theme';
import { gifById } from '@/data/mockGifs';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import type { JobComment } from '@/types';
import { formatPostedAt } from '@/utils/format';

const AVATAR = 34;
const REPLY_AVATAR = 26;
/** How far a reply is inset from its parent. One step only — threads never nest further. */
const REPLY_INDENT = AVATAR + spacing.md;

const POP = { duration: 130, easing: Easing.out(Easing.quad) };
const SLIDE = { duration: 170, easing: Easing.out(Easing.cubic) };

/** Width of the delete action revealed behind the row. */
const DELETE_WIDTH = 84;
/** Past this much drag, releasing snaps the action open rather than shut. */
const OPEN_THRESHOLD = 40;

interface CommentRowProps {
  comment: JobComment;
  /** True when this sits under a parent, which shrinks the avatar and insets the row. */
  isReply?: boolean;
  liked: boolean;
  onToggleLike: () => void;
  onReply: () => void;
  /** Omitted on comments the viewer can't remove, which disables the swipe entirely. */
  onDelete?: () => void;
  /**
   * Opens the report sheet. Omitted on the viewer's own comments — there is nothing to report
   * about yourself, and the database refuses it anyway.
   */
  onReport?: () => void;
}

/**
 * One comment. The like sits on the right at full row height rather than under the text,
 * so a column of hearts stays scannable down the thread — the same reason Instagram
 * puts it there instead of in the action line.
 *
 * The viewer's own comments swipe left to reveal Delete. It snaps open and waits for a
 * tap rather than deleting on release: a thread is scrolled vertically past these rows
 * constantly, and a gesture that destroys something on release is the wrong thing to
 * leave sitting under a scrolling thumb.
 *
 * -- Who wrote it, in phase 3 -------------------------------------------------
 *
 * There is no name here and there cannot be one. README §3.8's contract is that users are
 * anonymous to each other, so the row shows a generated pseudonym and, beside it, the badge the
 * database composed from the school the account actually verified. That badge is the useful half
 * of an identity for this product: it says whether the person answering knows what they are
 * talking about, without saying who they are.
 *
 * The avatar therefore carries a letter taken from the pseudonym rather than from a name, which
 * is also why it reads as a shape rather than as a person.
 */
export function CommentRow({
  comment,
  isReply = false,
  liked,
  onToggleLike,
  onReply,
  onDelete,
  onReport,
}: CommentRowProps) {
  const { colors } = useTheme();
  const styles = useStyles();

  const size = isReply ? REPLY_AVATAR : AVATAR;
  const gif = gifById(comment.gifId);
  const canDelete = onDelete !== undefined;

  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const offsetX = useSharedValue(0);

  // A short pop on the way in only — liking should feel like a tap landing, and a
  // spring here reads as bouncy next to the still text around it.
  useEffect(() => {
    if (liked) scale.value = withSequence(withTiming(1.25, POP), withTiming(1, POP));
  }, [liked, scale]);

  const heartStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const slideStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));
  // The action only shows while the row is actually moved off it.
  const actionStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, -translateX.value / OPEN_THRESHOLD),
  }));

  const handleDelete = () => {
    translateX.value = withTiming(0, SLIDE);
    offsetX.value = 0;
    onDelete?.();
  };

  // Horizontal only: the thread scrolls vertically through these rows, so anything with
  // a vertical component has to fall through to the list.
  const swipe = Gesture.Pan()
    .enabled(canDelete)
    .activeOffsetX([-14, 14])
    .failOffsetY([-12, 12])
    .onUpdate((event) => {
      'worklet';
      translateX.value = Math.min(0, Math.max(-DELETE_WIDTH, offsetX.value + event.translationX));
    })
    .onEnd(() => {
      'worklet';
      const open = translateX.value < -OPEN_THRESHOLD;
      translateX.value = withTiming(open ? -DELETE_WIDTH : 0, SLIDE);
      offsetX.value = open ? -DELETE_WIDTH : 0;
    });

  const replyTargetLabel = comment.isYou ? 'your comment' : comment.authorHandle;
  // First letter of the pseudonym. Not a name's initial, because there is no name.
  const initial = comment.authorHandle.charAt(0).toUpperCase();

  return (
    <View style={styles.wrapper}>
      {canDelete ? (
        <Animated.View style={[styles.action, actionStyle]}>
          <Pressable
            onPress={handleDelete}
            accessibilityRole="button"
            accessibilityLabel="Delete your comment"
            style={({ pressed }) => [styles.deleteButton, pressed ? styles.pressed : null]}>
            <Ionicons name="trash-outline" size={17} color={colors.textOnBrand} />
            <Text style={styles.deleteLabel}>Delete</Text>
          </Pressable>
        </Animated.View>
      ) : null}

      <GestureDetector gesture={swipe}>
        <Animated.View
          style={[
            styles.row,
            isReply ? styles.rowReply : null,
            comment.pending ? styles.pendingRow : null,
            slideStyle,
          ]}>
          <View
            style={[
              styles.avatar,
              {
                width: size,
                height: size,
                borderRadius: size / 2,
                backgroundColor: comment.authorColor,
              },
            ]}>
            <Text style={[styles.avatarText, isReply ? styles.avatarTextReply : null]}>
              {initial}
            </Text>
          </View>

          <View style={styles.body}>
            <View style={styles.meta}>
              <Text style={styles.author} numberOfLines={1}>
                {comment.isYou ? 'You' : comment.authorHandle}
              </Text>
              {/* The badge is the credential, so it gets its own text rather than being appended
                  to the handle and truncated away on a narrow screen. */}
              {comment.authorBadge ? (
                <Text style={styles.badge} numberOfLines={1}>
                  {comment.authorBadge}
                </Text>
              ) : null}
              <Text style={styles.time}>{formatPostedAt(comment.createdAt)}</Text>
            </View>

            {comment.body.length > 0 ? <Text style={styles.text}>{comment.body}</Text> : null}

            {gif ? (
              <Image
                source={gif.source}
                style={styles.gif}
                resizeMode="cover"
                accessible
                accessibilityRole="image"
                accessibilityLabel={gif.label + ' GIF'}
              />
            ) : null}

            <View style={styles.actions}>
              {/* A comment this device wrote and the server has not confirmed. It cannot be
                  replied to or reported yet: it has no id anybody else could act on. */}
              {comment.pending ? (
                <Text style={styles.replyLabel}>Sending...</Text>
              ) : (
                <>
                  <Pressable
                    onPress={onReply}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={'Reply to ' + replyTargetLabel}
                    style={({ pressed }) => [styles.replyButton, pressed ? styles.pressed : null]}>
                    <Text style={styles.replyLabel}>Reply</Text>
                  </Pressable>

                  {onReport ? (
                    <Pressable
                      onPress={onReport}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={'Report this comment, or block ' + replyTargetLabel}
                      style={({ pressed }) => [styles.replyButton, pressed ? styles.pressed : null]}>
                      <Text style={styles.replyLabel}>Report</Text>
                    </Pressable>
                  ) : null}
                </>
              )}
            </View>
          </View>

          <Pressable
            onPress={onToggleLike}
            disabled={comment.pending === true}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityState={{ selected: liked, disabled: comment.pending === true }}
            accessibilityLabel={liked ? 'Unlike this comment' : 'Like this comment'}
            style={({ pressed }) => [styles.like, pressed ? styles.pressed : null]}>
            <Animated.View style={heartStyle}>
              <Ionicons
                name={liked ? 'heart' : 'heart-outline'}
                size={15}
                color={liked ? colors.like : colors.textTertiary}
              />
            </Animated.View>
            {comment.likeCount > 0 ? (
              <Text style={[styles.likeCount, liked ? styles.likeCountActive : null]}>
                {comment.likeCount}
              </Text>
            ) : null}
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  // Dimmed rather than replaced by a spinner: the text is what the writer is looking at, and
  // taking it away to show progress is worse than showing it faintly.
  pendingRow: {
    opacity: 0.55,
  },
  badge: {
    fontSize: fontSize.caption,
    color: colors.textTertiary,
    fontWeight: '600',
    flexShrink: 1,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  wrapper: {
    justifyContent: 'center',
  },
  action: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: DELETE_WIDTH,
    justifyContent: 'center',
  },
  deleteButton: {
    flex: 1,
    marginVertical: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.like,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  deleteLabel: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    color: colors.textOnBrand,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    // Opaque so the delete action stays hidden until the row is moved off it.
    backgroundColor: colors.surface,
  },
  rowReply: {
    paddingLeft: REPLY_INDENT,
  },
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    // Always light: this sits on the commenter's own colour, not a themed surface.
    color: '#FFFFFF',
    fontSize: fontSize.caption,
    fontWeight: '700',
  },
  avatarTextReply: {
    fontSize: 9,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  author: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.text,
    flexShrink: 1,
  },
  time: {
    fontSize: fontSize.caption,
    color: colors.textTertiary,
  },
  text: {
    fontSize: fontSize.small,
    lineHeight: 19,
    color: colors.textSecondary,
  },
  gif: {
    width: 150,
    height: 112,
    borderRadius: radius.md,
    marginTop: 4,
  },
  replyButton: {
    alignSelf: 'flex-start',
    paddingTop: 3,
  },
  replyLabel: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    color: colors.textTertiary,
  },
  like: {
    alignItems: 'center',
    gap: 2,
    minWidth: 28,
    paddingTop: 2,
  },
  likeCount: {
    fontSize: fontSize.caption,
    color: colors.textTertiary,
    fontWeight: '600',
  },
  likeCountActive: {
    color: colors.like,
  },
  pressed: {
    opacity: 0.6,
  },
}));
