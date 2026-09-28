import Ionicons from '@expo/vector-icons/Ionicons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/common/PrimaryButton';
import { StartupError } from '@/components/common/StartupError';
import { fontSize, radius, screenPadding, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { cancelAccountDeletion, fetchAccountStatus } from '@/lib/api';

interface AccountGateProps {
  message: string;
  onRetry: () => void;
  onSignOut: () => void;
}

/**
 * What a signed-in reader sees when their profile cannot be read — which, since phase 7, has two
 * causes that look identical from `useProfile`.
 *
 * A pending deletion hides the profile on purpose: phase 0's policy has required
 * `deleted_at is null` since the first migration, and §13.2's "account disabled immediately" is
 * that policy doing its job. So before blaming the network, this asks `my_account_status()` —
 * which still answers — and offers the one thing a disabled account can do: change its mind.
 */
export function AccountGate({ message, onRetry, onSignOut }: AccountGateProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const status = useQuery({ queryKey: ['account-status'], queryFn: fetchAccountStatus, retry: 1 });

  if (status.isLoading) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.content}><ActivityIndicator /></View>
      </SafeAreaView>
    );
  }

  const purgeAfter = status.data?.purgeAfter;
  if (!purgeAfter) return <StartupError message={message} onRetry={onRetry} onSignOut={onSignOut} />;

  const date = new Date(purgeAfter).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });

  const restore = async () => {
    setBusy(true);
    try {
      await cancelAccountDeletion();
      await queryClient.invalidateQueries();
      onRetry();
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>
        <View style={styles.icon}>
          <Ionicons name="time-outline" size={26} color={colors.textSecondary} />
        </View>
        <Text style={styles.title} accessibilityRole="header">Your account is scheduled for deletion</Text>
        <Text style={styles.detail}>
          Everything will be permanently deleted on {date}. Until then you can change your mind and
          get it all back. Comments you posted stay up, with your pseudonym replaced, so the threads
          still make sense.
        </Text>
        <View style={styles.actions}>
          <PrimaryButton label="Keep my account" onPress={() => void restore()} loading={busy} />
          <PrimaryButton label="Sign out" onPress={onSignOut} variant="ghost" />
        </View>
      </View>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, justifyContent: 'center', paddingHorizontal: screenPadding, gap: spacing.md },
  icon: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backgroundMuted,
    marginBottom: spacing.xs,
  },
  title: { fontSize: fontSize.heading, fontWeight: '700', color: colors.text, letterSpacing: -0.4 },
  detail: { fontSize: fontSize.small, color: colors.textSecondary, lineHeight: 20 },
  actions: { gap: spacing.sm, marginTop: spacing.lg },
}));
