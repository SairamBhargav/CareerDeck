import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IconButton } from '@/components/common/IconButton';
import { RowGroup, type RowGroupItem } from '@/components/common/RowGroup';
import { SectionHeader } from '@/components/common/SectionHeader';
import { Toggle } from '@/components/common/Toggle';
import { ThemeSwitch } from '@/components/settings/ThemeSwitch';
import { fontSize, screenPadding, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';

/**
 * Reached from the gear icon on Profile. Split out from Profile so identity/career stats
 * (what you are) stay separate from preferences/account (how the app behaves) — the gear
 * icon existed on Profile as a dead tap before this screen did.
 */
export default function SettingsScreen() {
  const router = useRouter();
  const styles = useStyles();
  const { scheme } = useTheme();
  const isDark = scheme === 'dark';

  // Local-only: there's no notification pipeline yet, so this doesn't send anything
  // anywhere. It's real state, just with nothing behind it to flip on.
  const [pushEnabled, setPushEnabled] = useState(true);

  const appearanceRows: RowGroupItem[] = [
    {
      key: 'dark-mode',
      icon: isDark ? 'moon-outline' : 'sunny-outline',
      label: 'Dark mode',
      hint: isDark ? 'On' : 'Off',
      right: <ThemeSwitch />,
    },
  ];

  const notificationRows: RowGroupItem[] = [
    {
      key: 'push',
      icon: 'notifications-outline',
      label: 'Push notifications',
      hint: pushEnabled ? 'On' : 'Off',
      right: (
        <Toggle value={pushEnabled} onValueChange={setPushEnabled} accessibilityLabel="Push notifications" />
      ),
    },
  ];

  const accountRows: RowGroupItem[] = [
    { key: 'edit-profile', icon: 'person-outline', label: 'Edit profile', soon: true },
    { key: 'password', icon: 'lock-closed-outline', label: 'Change password', soon: true },
  ];

  const supportRows: RowGroupItem[] = [
    { key: 'help', icon: 'help-circle-outline', label: 'Help Center', soon: true },
    { key: 'privacy', icon: 'shield-checkmark-outline', label: 'Privacy Policy', soon: true },
    { key: 'terms', icon: 'document-text-outline', label: 'Terms of Service', soon: true },
  ];

  const sessionRows: RowGroupItem[] = [{ key: 'sign-out', icon: 'log-out-outline', label: 'Sign out', soon: true }];

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.topBar}>
          <IconButton name="chevron-back" accessibilityLabel="Go back" onPress={() => router.back()} surface />
          <Text style={styles.heading} accessibilityRole="header">
            Settings
          </Text>
          <View style={styles.spacer} />
        </View>

        <View>
          <SectionHeader title="Appearance" />
          <RowGroup items={appearanceRows} />
        </View>

        <View>
          <SectionHeader title="Notifications" />
          <RowGroup items={notificationRows} />
        </View>

        <View>
          <SectionHeader title="Account" />
          <RowGroup items={accountRows} />
        </View>

        <View>
          <SectionHeader title="Support" />
          <RowGroup items={supportRows} />
        </View>

        <RowGroup items={sessionRows} />

        <Text style={styles.footnote}>
          Account, notifications delivery, and support links arrive once CareerDeck has a backend.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: screenPadding,
    paddingBottom: spacing.xxl,
    gap: spacing.xl,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
  },
  heading: {
    fontSize: fontSize.heading,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.4,
  },
  spacer: {
    width: 44,
  },
  footnote: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    textAlign: 'center',
    lineHeight: 19,
  },
}));
