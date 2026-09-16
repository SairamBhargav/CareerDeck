import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, radius, screenPadding, spacing } from '@/constants/theme';

interface EmptyStateProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  message: string;
  onDark?: boolean;
}

export function EmptyState({ icon, title, message, onDark = false }: EmptyStateProps) {
  const tint = onDark ? colors.reelTextSecondary : colors.textTertiary;

  return (
    <View style={styles.container}>
      <View style={[styles.iconWrap, onDark ? styles.iconWrapDark : styles.iconWrapLight]}>
        <Ionicons name={icon} size={26} color={tint} />
      </View>
      <Text style={[styles.title, onDark ? styles.titleDark : styles.titleLight]}>{title}</Text>
      <Text style={[styles.message, { color: tint }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: screenPadding + spacing.lg,
    paddingVertical: spacing.xxl,
    gap: spacing.sm,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  iconWrapLight: { backgroundColor: colors.backgroundMuted },
  iconWrapDark: { backgroundColor: colors.reelSurface },
  title: {
    fontSize: fontSize.title,
    fontWeight: '700',
    textAlign: 'center',
  },
  titleLight: { color: colors.text },
  titleDark: { color: colors.reelText },
  message: {
    fontSize: fontSize.body,
    lineHeight: 21,
    textAlign: 'center',
  },
});
