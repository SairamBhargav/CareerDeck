import Ionicons from '@expo/vector-icons/Ionicons';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/common/PrimaryButton';
import { fontSize, radius, screenPadding, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';

interface StartupErrorProps {
  message: string;
  onRetry: () => void;
  onSignOut: () => void;
}

/**
 * Shown when there is a session but the profile behind it could not be read.
 *
 * Without this the app renders its shell around a user it doesn't have: blank names,
 * empty counts, and no indication that anything is wrong. A dead end with two ways out
 * is better than a screen that looks like it worked.
 */
export function StartupError({ message, onRetry, onSignOut }: StartupErrorProps) {
  const styles = useStyles();
  const { colors } = useTheme();

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>
        <View style={styles.icon}>
          <Ionicons name="cloud-offline-outline" size={26} color={colors.textSecondary} />
        </View>

        <Text style={styles.title} accessibilityRole="header">
          Couldn&rsquo;t load your profile
        </Text>
        <Text style={styles.detail}>{message}</Text>

        <View style={styles.actions}>
          <PrimaryButton label="Try again" onPress={onRetry} />
          <PrimaryButton label="Sign out" onPress={onSignOut} variant="ghost" />
        </View>
      </View>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: screenPadding,
    gap: spacing.md,
  },
  icon: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backgroundMuted,
    marginBottom: spacing.xs,
  },
  title: {
    fontSize: fontSize.heading,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.4,
  },
  detail: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
}));
