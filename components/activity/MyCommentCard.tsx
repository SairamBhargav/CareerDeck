import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { CompanyLogo } from '@/components/common/CompanyLogo';
import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { gifById } from '@/data/mockGifs';
import { useKlipyGif } from '@/hooks/useGifs';
import { klipySlugOf } from '@/lib/klipy';
import type { MyComment } from '@/types';
import { formatPostedAt } from '@/utils/format';

interface MyCommentCardProps {
  comment: MyComment;
  onPress: () => void;
}

/**
 * One of your own comments in Activity → Comments: where it is, what you said, how it landed.
 *
 * A comment that was taken down still appears, marked, because the author was told it was and a
 * list that silently dropped it would contradict the notice they just read.
 */
export function MyCommentCard({ comment, onPress }: MyCommentCardProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const bundled = gifById(comment.gifId);
  const klipy = useKlipyGif(klipySlugOf(comment.gifId)).data ?? null;
  const gifUri = klipy?.preview.url;
  const hasGif = bundled !== undefined || gifUri !== undefined;

  const where = comment.companyName.length > 0 ? `${comment.jobTitle} · ${comment.companyName}` : comment.jobTitle;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Your ${comment.parentId ? 'reply' : 'comment'} on ${where}: ${comment.body || 'a GIF'}`}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}>
      <View style={styles.head}>
        <CompanyLogo logo={comment.companyLogoUrl ?? comment.companyName.slice(0, 1)} name={comment.companyName} size="sm" />
        <Text style={styles.where} numberOfLines={1}>
          {comment.parentId ? 'Reply on ' : ''}
          {where}
        </Text>
      </View>

      <View style={styles.bodyRow}>
        {comment.body.length > 0 ? (
          <Text style={[styles.body, hasGif ? styles.bodyBeside : null]} numberOfLines={3}>
            {comment.body}
          </Text>
        ) : null}
        {bundled ? (
          <Image source={bundled.source} style={styles.gif} resizeMode="cover" />
        ) : gifUri ? (
          <Image source={{ uri: gifUri }} style={styles.gif} resizeMode="cover" />
        ) : null}
      </View>

      {comment.status === 'live' ? null : (
        <View style={styles.status}>
          <Ionicons name="eye-off-outline" size={12} color={colors.danger} />
          <Text style={styles.statusText}>
            {comment.status === 'underReview' ? 'Taken down · a moderator will review it' : 'Removed by a moderator'}
          </Text>
        </View>
      )}

      <View style={styles.footer}>
        <View style={styles.stat}>
          <Ionicons name="heart" size={12} color={comment.likeCount > 0 ? colors.like : colors.textTertiary} />
          <Text style={styles.statText}>{comment.likeCount}</Text>
        </View>
        {comment.parentId === null ? (
          <View style={styles.stat}>
            <Ionicons name="chatbubble-outline" size={12} color={colors.textTertiary} />
            <Text style={styles.statText}>
              {comment.replyCount === 1 ? '1 reply' : `${comment.replyCount} replies`}
            </Text>
          </View>
        ) : null}
        <Text style={styles.time}>{formatPostedAt(comment.createdAt)}</Text>
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
  pressed: {
    opacity: 0.7,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  where: {
    flex: 1,
    fontSize: fontSize.caption,
    fontWeight: '600',
    color: colors.textTertiary,
  },
  bodyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  body: {
    flex: 1,
    fontSize: fontSize.small,
    lineHeight: 20,
    color: colors.text,
  },
  bodyBeside: {
    flex: 1,
  },
  gif: {
    width: 72,
    height: 54,
    borderRadius: 8,
    backgroundColor: colors.backgroundMuted,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusText: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    color: colors.danger,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  stat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statText: {
    fontSize: fontSize.caption,
    color: colors.textTertiary,
  },
  time: {
    marginLeft: 'auto',
    fontSize: fontSize.caption,
    color: colors.textTertiary,
  },
}));
