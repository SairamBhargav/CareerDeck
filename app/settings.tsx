import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GoalPickerSheet } from '@/components/common/GoalPickerSheet';
import { IconButton } from '@/components/common/IconButton';
import { RowGroup, type RowGroupItem } from '@/components/common/RowGroup';
import { useVerification } from '@/hooks/useVerification';
import { SectionHeader } from '@/components/common/SectionHeader';
import { ThemeSwitch } from '@/components/settings/ThemeSwitch';
import { AUTO_APPLY_ECONOMY } from '@/constants/goal';
import { fontSize, screenPadding, spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useWeeklyGoal } from '@/hooks/useWeeklyGoal';

/** Per-section stagger as the page settles. */
const STAGGER_MS = 55;

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

  const { weeklyGoal, setWeeklyGoal, autoApplyCredits } = useCareerDeck();
  const { session, userId, signOut } = useAuth();
  const goal = useWeeklyGoal();
  const verification = useVerification(userId);

  const [editingGoal, setEditingGoal] = useState(false);

  // Signing out is cheap to undo but expensive to do by accident — you lose whatever
  // was mid-edit and have to wait on an email for a new code.
  const confirmSignOut = () =>
    Alert.alert('Sign out?', 'You will need to sign in again to get back in.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          signOut().catch((error: unknown) =>
            Alert.alert('Could not sign out', error instanceof Error ? error.message : String(error)),
          );
        },
      },
    ]);

  const applyingRows: RowGroupItem[] = [
    {
      key: 'weekly-goal',
      icon: 'golf-outline',
      label: 'Weekly goal',
      hint: goal.met ? `Met — ${goal.count} sent this week` : `${goal.remaining} to go this week`,
      value: `${weeklyGoal} a week`,
      onPress: () => setEditingGoal(true),
    },
    {
      key: 'auto-apply',
      icon: 'flash-outline',
      label: 'Auto Apply',
      // Spells out the whole economy rather than just the balance: a currency the user
      // can't predict the supply of is one they hoard instead of spending.
      hint: `${AUTO_APPLY_ECONOMY.dailyGrant} a day, up to ${AUTO_APPLY_ECONOMY.maxWeeklyBonus} more for a week at goal`,
      value: `${autoApplyCredits} left`,
    },
  ];

  const appearanceRows: RowGroupItem[] = [
    {
      key: 'dark-mode',
      icon: isDark ? 'moon-outline' : 'sunny-outline',
      label: 'Dark mode',
      hint: isDark ? 'On' : 'Off',
      right: <ThemeSwitch />,
    },
  ];

  // Honest as "Soon": a toggle that flips is a promise that something gets delivered,
  // and there is no notification pipeline behind it. It was local state before, which
  // looked like it worked and didn't.
  const notificationRows: RowGroupItem[] = [
    { key: 'push', icon: 'notifications-outline', label: 'Push notifications', soon: true },
    { key: 'goal-reminder', icon: 'alarm-outline', label: 'Weekly goal reminder', soon: true },
  ];

  const accountRows: RowGroupItem[] = [
    { key: 'edit-profile', icon: 'person-outline', label: 'Edit profile', onPress: () => router.push('/profile') },
    {
      key: 'verification',
      icon: 'shield-checkmark-outline',
      label: 'Verification',
      /*
       * The hint states what verification is *for*, not just whether it is done. §3.2 puts the gate
       * on commenting alone — everything else works on a plain email account — and a row that read
       * "Not verified" with no object would imply the account is somehow incomplete.
       */
      hint: verification.canComment
        ? (verification.badge ?? 'Verified — you can comment')
        : 'Verify to comment on postings',
      onPress: () => router.push('/verify'),
    },
    {
      key: 'email',
      icon: 'mail-outline',
      label: 'Email',
      // Straight off the session rather than the profile: this is the address the
      // account is keyed on, and it is not one of the fields the profile editor owns.
      hint: session?.user.email ?? undefined,
    },
  ];

  const supportRows: RowGroupItem[] = [
    { key: 'help', icon: 'help-circle-outline', label: 'Help Center', soon: true },
    { key: 'privacy', icon: 'shield-checkmark-outline', label: 'Privacy Policy', soon: true },
    { key: 'terms', icon: 'document-text-outline', label: 'Terms of Service', soon: true },
  ];

  const sessionRows: RowGroupItem[] = [
    {
      key: 'sign-out',
      icon: 'log-out-outline',
      label: 'Sign out',
      onPress: confirmSignOut,
    },
  ];

  const sections: { key: string; title?: string; rows: RowGroupItem[] }[] = [
    { key: 'applying', title: 'Applying', rows: applyingRows },
    { key: 'appearance', title: 'Appearance', rows: appearanceRows },
    { key: 'notifications', title: 'Notifications', rows: notificationRows },
    { key: 'account', title: 'Account', rows: accountRows },
    { key: 'support', title: 'Support', rows: supportRows },
    { key: 'session', rows: sessionRows },
  ];

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

        {sections.map((section, index) => (
          <Animated.View key={section.key} entering={FadeInDown.duration(280).delay(index * STAGGER_MS)}>
            {section.title ? <SectionHeader title={section.title} /> : null}
            <RowGroup items={section.rows} />
          </Animated.View>
        ))}

        <View style={styles.footer}>
          <Text style={styles.version}>CareerDeck {version()}</Text>
          <Text style={styles.footnote}>
            Notification delivery and support links arrive with the rest of the backend.
          </Text>
        </View>
      </ScrollView>

      <GoalPickerSheet
        visible={editingGoal}
        current={weeklyGoal}
        countThisWeek={goal.count}
        onSelect={(target) => {
          setWeeklyGoal(target);
          setEditingGoal(false);
        }}
        onClose={() => setEditingGoal(false)}
      />
    </SafeAreaView>
  );
}

/** Reads the version straight off app.json, so it can't be a hard-coded lie. */
function version(): string {
  return Constants.expoConfig?.version ?? '—';
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
  footer: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  version: {
    fontSize: fontSize.caption + 1,
    fontWeight: '700',
    letterSpacing: 0.4,
    color: colors.textTertiary,
  },
  footnote: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    textAlign: 'center',
    lineHeight: 19,
  },
}));
