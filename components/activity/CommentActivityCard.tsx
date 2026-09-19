import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import type { CommentActivity } from '@/types';
import { formatPostedAt } from '@/utils/format';

interface CommentActivityCardProps {
  entry: CommentActivity;
  /** Title of the posting the thread sits on, resolved by the screen. */
  jobTitle: string;
  companyName: string;
  onPress: () => void;
}

/**
 * One notification about something the user wrote.
 *
 * The reply — or the fact of the likes — leads, and the user's own comment is quoted
 * underneath in a rule-marked block. That order is deliberate: the user already knows
 * what they said, so making them read it first to reach the new information wastes the
 * only line that matters.
 */
export function CommentActivityCard({ entry, jobTitle, companyName, onPress }: CommentActivityCardProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const isReply = entry.type === 'reply';

  const headline = isReply
    ? `${entry.actorName} replied to you`
    : entry.likeCount && entry.likeCount > 1
      ? `${entry.actorName} and ${entry.likeCount - 1} others liked your comment`
      : `${entry.actorName} liked your comment`;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${headline}, on ${jobTitle} at ${companyName}`}
      style={({ pressed }) => [
        styles.card,
        entry.read ? null : styles.unread,
        pressed ? styles.pressed : null,
      ]}>
      <View style={styles.head}>
        <View style={[styles.avatar, { backgroundColor: entry.actorColor }]}>
          <Text style={styles.avatarText}>{entry.actorInitials}</Text>
        </View>

        <View style={styles.headText}>
          <Text style={styles.headline} numberOfLines={2}>
            {headline}
          </Text>
          <Text style={styles.context} numberOfLines={1}>
            {jobTitle} {'·'} {companyName}
          </Text>
        </View>

        {entry.read ? null : <View style={styles.dot} />}
      </View>

      {isReply && entry.replyBody ? (
        <Text style={styles.reply} numberOfLines={3}>
          {entry.replyBody}
        </Text>
      ) : null}

      <View style={styles.quote}>
        <View style={styles.quoteRule} />
        <Text style={styles.quoteText} numberOfLines={2}>
          {entry.yourComment}
        </Text>
      </View>

      <View style={styles.footer}>
        <Ionicons
          name={isReply ? 'chatbubble-outline' : 'heart'}
          size={12}
          color={isReply ? colors.textTertiary : colors.like}
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
  // Unread leans on the border rather than a tinted fill: a colored card behind this
  // much text hurts legibility, and the dot already carries the state.
  unread: {
    borderColor: colors.borderStrong,
  },
  pressed: {
    opacity: 0.75,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: fontSize.caption + 1,
    fontWeight: '700',
    color: colors.textOnBrand,
  },
  headText: {
    flex: 1,
    gap: 1,
  },
  headline: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.text,
    lineHeight: 18,
  },
  context: {
    fontSize: fontSize.caption,
    color: colors.textTertiary,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.autoApply,
  },
  reply: {
    fontSize: fontSize.body,
    color: colors.text,
    lineHeight: 20,
  },
  quote: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  quoteRule: {
    width: 2,
    borderRadius: 1,
    backgroundColor: colors.border,
  },
  quoteText: {
    flex: 1,
    fontSize: fontSize.small,
    color: colors.textTertiary,
    lineHeight: 18,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 1,
  },
  time: {
    fontSize: fontSize.caption,
    color: colors.textTertiary,
  },
}));
