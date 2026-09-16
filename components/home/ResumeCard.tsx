import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, radius, spacing } from '@/constants/theme';
import { formatPostedAt } from '@/utils/format';

interface ResumeCardProps {
  resumeName: string;
  updatedAt: string;
  onPress: () => void;
}

export function ResumeCard({ resumeName, updatedAt, onPress }: ResumeCardProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${resumeName}, updated ${formatPostedAt(updatedAt)}. View profile.`}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}>
      <View style={styles.icon}>
        <Ionicons name="document-text-outline" size={20} color={colors.text} />
      </View>

      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1}>
          {resumeName}
        </Text>
        <Text style={styles.meta}>Updated {formatPostedAt(updatedAt).toLowerCase()}</Text>
      </View>

      <Text style={styles.action}>View</Text>
      <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.backgroundMuted,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  pressed: {
    opacity: 0.7,
  },
  icon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
  },
  name: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.text,
  },
  meta: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    marginTop: 1,
  },
  action: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.textSecondary,
  },
});
