import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import type { AppNotification } from '@/types';
import { formatPostedAt } from '@/utils/format';

interface NotificationCardProps {
  entry: AppNotification;
  /** Title of the posting the thread sits on, resolved by the screen. Empty when it is gone. */
  jobTitle: string;
  companyName: string;
  onPress: () => void;
}

/**
 * One notification. Replaces `CommentActivityCard`, which only knew about replies and likes.
 *
 * The reply — or the fact of the likes — leads, and the user's own comment is quoted underneath in a
 * rule-marked block. That order is deliberate: the user already knows what they said, so making
 * them read it first to reach the new information wastes the only line that matters.
 *
 * ── Moderation notices are the same card ──────────────────────────────────────
 *
 * A removal, a mute and an expiring `.edu` address render here too, and giving them their own
 * screen was the alternative. §10 requires that a user is *told* rather than left guessing ("do not
 * silently revoke — notify"), and the place somebody looks for "did anything happen" is this list.
 * A second inbox for bad news is an inbox nobody opens.
 *
 * They have no actor, which is the visible difference: there is no avatar, because "CareerDeck
 * removed your comment" is not a person doing something to you, and drawing a face on it would
 * suggest it was.
 */
export function NotificationCard({ entry, jobTitle, companyName, onPress }: NotificationCardProps) {
  const { colors } = useTheme();
  const styles = useStyles();

  const isReply = entry.kind === 'comment_reply';
  const isLike = entry.kind === 'comment_like';
  const isSystem = !isReply && !isLike;

  const headline = isSystem
    ? (entry.headline ?? 'Something happened on your account')
    : isReply
      ? `${entry.actorHandle ?? 'Someone'} replied to you`
      : entry.aggregateCount > 1
        ? `${entry.actorHandle ?? 'Someone'} and ${entry.aggregateCount - 1} others liked your comment`
        : `${entry.actorHandle ?? 'Someone'} liked your comment`;

  const context = isSystem
    ? entry.detail
    : companyName.length > 0
      ? `${jobTitle} · ${companyName}`
      : jobTitle;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${headline}${context ? `, ${context}` : ''}`}
      style={({ pressed }) => [
        styles.card,
        entry.read ? null : styles.unread,
        pressed ? styles.pressed : null,
      ]}>
      <View style={styles.head}>
        {isSystem ? (
          <View style={[styles.avatar, styles.systemAvatar]}>
            <Ionicons
              name={entry.kind === 'verification' ? 'shield-checkmark-outline' : 'alert-circle-outline'}
              size={17}
              color={colors.textSecondary}
            />
          </View>
        ) : (
          <View style={[styles.avatar, { backgroundColor: entry.actorColor ?? colors.accent }]}>
            {/* A letter off the pseudonym, not initials off a name — there is no name. */}
            <Text style={styles.avatarText}>
              {(entry.actorHandle ?? '?').charAt(0).toUpperCase()}
            </Text>
          </View>
        )}

        <View style={styles.headText}>
          <Text style={styles.headline} numberOfLines={2}>
            {headline}
          </Text>
          {context ? (
            <Text style={styles.context} numberOfLines={2}>
              {context}
            </Text>
          ) : null}
        </View>

        {entry.read ? null : <View style={styles.dot} />}
      </View>

      {isReply && entry.replyBody ? (
        <Text style={styles.reply} numberOfLines={3}>
          {entry.replyBody}
        </Text>
      ) : null}

      {entry.yourComment ? (
        <View style={styles.quote}>
          <View style={styles.quoteRule} />
          <Text style={styles.quoteText} numberOfLines={2}>
            {entry.yourComment}
          </Text>
        </View>
      ) : null}

      <View style={styles.footer}>
        <Ionicons
          name={isReply ? 'chatbubble-outline' : isLike ? 'heart' : 'information-circle-outline'}
          size={12}
          color={isLike ? colors.like : colors.textTertiary}
        />
        <Text style={styles.time}>{formatPostedAt(entry.createdAt)}</Text>
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    gap: spacing.sm,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  unread: {
    borderColor: colors.borderStrong,
    backgroundColor: colors.backgroundMuted,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  systemAvatar: {
    backgroundColor: colors.backgroundMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  avatarText: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.textOnBrand,
  },
  headText: {
    flex: 1,
    gap: 2,
  },
  headline: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.text,
  },
  context: {
    fontSize: fontSize.caption,
    lineHeight: 16,
    color: colors.textTertiary,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  reply: {
    fontSize: fontSize.small,
    lineHeight: 20,
    color: colors.text,
  },
  quote: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  quoteRule: {
    width: 2,
    borderRadius: 1,
    backgroundColor: colors.border,
  },
  quoteText: {
    flex: 1,
    fontSize: fontSize.caption,
    lineHeight: 17,
    color: colors.textTertiary,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  time: {
    fontSize: fontSize.caption,
    color: colors.textTertiary,
  },
  pressed: {
    opacity: 0.7,
  },
}));
