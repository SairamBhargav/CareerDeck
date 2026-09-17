import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, View } from 'react-native';

import { fontSize, radius, screenPadding, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';

interface EmptyStateProps {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  message: string;
}

export function EmptyState({ icon, title, message }: EmptyStateProps) {
  const { colors } = useTheme();
  const styles = useStyles();

  return (
    <View style={styles.container}>
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={26} color={colors.textTertiary} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
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
    backgroundColor: colors.backgroundMuted,
  },
  title: {
    fontSize: fontSize.title,
    fontWeight: '700',
    textAlign: 'center',
    color: colors.text,
  },
  message: {
    fontSize: fontSize.body,
    lineHeight: 21,
    textAlign: 'center',
    color: colors.textTertiary,
  },
}));
