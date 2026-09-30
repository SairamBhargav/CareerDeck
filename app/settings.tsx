import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
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
import { Toggle } from '@/components/common/Toggle';
import { useNotificationSettings } from '@/hooks/useNotificationSettings';
import { deleteAccountNow, exportMyData } from '@/lib/api';
import { ServiceError } from '@/lib/service';
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

  const { weeklyGoal, setWeeklyGoal, autoApplyCredits, credits, retryProfile } = useCareerDeck();
  const { session, userId, signOut } = useAuth();
  const goal = useWeeklyGoal();
  const verification = useVerification(userId);

  const [editingGoal, setEditingGoal] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const notify = useNotificationSettings(userId);

  /*
   * §13.2's export. The service builds the whole bundle in one request; it is written to the
   * cache and handed to the share sheet, so the reader chooses where it goes — Files, email,
   * AirDrop — and CareerDeck keeps no copy of it anywhere.
   */
  const exportData = async () => {
    setExporting(true);
    try {
      const bundle = await exportMyData();
      const path = `${FileSystem.cacheDirectory}careerdeck-export-${new Date().toISOString().slice(0, 10)}.json`;
      await FileSystem.writeAsStringAsync(path, JSON.stringify(bundle, null, 2));
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, { mimeType: 'application/json', dialogTitle: 'Your CareerDeck data' });
      } else {
        Alert.alert('Export ready', `Saved to ${path}`);
      }
    } catch (error) {
      Alert.alert(
        'Could not export',
        error instanceof ServiceError && error.code === 'rate_limited'
          ? 'You can export once a day. Try again tomorrow.'
          : error instanceof Error ? error.message : String(error),
      );
    } finally {
      setExporting(false);
    }
  };

  /*
   * Two steps, and plain about what it does.
   *
   * This is the immediate purge, not the thirty-day one. Nothing requires the wait —
   * GDPR Art. 17 says "without undue delay" and CCPA allows forty-five days, so a grace
   * period is permitted rather than mandated and erasing now is the more compliant of
   * the two. The window exists for three practical reasons: undoing a mistake, a
   * subscription still mid-period, and a moderated account resetting its strikes by
   * deleting and registering again.
   *
   * That last one is the reason to revisit this before launch. Phase 3 built strikes,
   * blocks and a review queue, and an account that can be recreated on the same address
   * in a minute defeats all three. Right now the app has five users and no abuse, and
   * being able to start clean is worth more than a defence against a problem that does
   * not exist yet. `requestAccountDeletion` is still in lib/api.ts for the day it does.
   */
  const confirmDelete = () =>
    Alert.alert(
      'Delete your account?',
      'This deletes everything now and cannot be undone — your profile, resumes, saved roles and applications. Your comments stay up with your name removed. You can sign up again with the same email straight away.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setDeleting(true);
            deleteAccountNow()
              // Sign out rather than refresh: the session names a user who no longer
              // exists, so every read after this would fail on an account that is gone.
              .then(() => signOut())
              .catch((error: unknown) => {
                setDeleting(false);
                Alert.alert('Could not delete', error instanceof Error ? error.message : String(error));
              });
          },
        },
      ],
    );

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
      // can't predict the supply of is one they hoard instead of spending. The numbers are
      // the plan's, from the server — a subscriber's row says five a day, not one.
      hint: `${credits.dailyGrant} a day, banks up to ${credits.bankCap}, more for a week at goal`,
      value: `${autoApplyCredits} left`,
    },
    {
      key: 'plan',
      icon: 'sparkles-outline',
      label: credits.isPro ? 'CareerDeck Pro' : 'Get Pro',
      hint: credits.isPro ? 'Manage your subscription' : 'More Auto Applies and resume slots',
      onPress: () => router.push('/paywall'),
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

  /*
   * Real since phase 7 — these were "Soon" because a toggle that flips is a promise that something
   * gets delivered. The device switch is permission plus a token; the rest are account-wide and
   * read by the server when it decides whether to send.
   */
  const pushHint =
    notify.lastOutcome === 'no_project' ? 'Needs an EAS project id — see SETUP.md'
      : notify.lastOutcome === 'denied' ? "Allow notifications in your phone's Settings"
        : notify.lastOutcome === 'failed' ? 'Could not register this device'
          : notify.devicePush ? 'On for this device' : 'Off for this device';
  const pref = (channel: 'push' | 'email', name: string, value: boolean, label: string) => (
    <Toggle value={value} onValueChange={(v) => notify.setPref(channel, name, v)} accessibilityLabel={label} />
  );
  const notificationRows: RowGroupItem[] = [
    {
      key: 'push',
      icon: 'notifications-outline',
      label: 'Push notifications',
      hint: pushHint,
      right: (
        <Toggle
          value={notify.devicePush}
          onValueChange={(v) => void notify.setDevicePush(v)}
          accessibilityLabel="Push notifications on this device"
        />
      ),
    },
    { key: 'job-alerts', icon: 'briefcase-outline', label: 'New roles at companies you follow', hint: 'At most once a day', right: pref('push', 'job_alerts', notify.prefs.push.job_alerts, 'Job alerts') },
    { key: 'deadlines', icon: 'alarm-outline', label: 'Saved roles closing soon', right: pref('push', 'deadlines', notify.prefs.push.deadlines, 'Deadline reminders') },
    { key: 'replies', icon: 'chatbubble-outline', label: 'Replies to your comments', right: pref('push', 'replies', notify.prefs.push.replies, 'Replies') },
    { key: 'digest', icon: 'mail-outline', label: 'Weekly email digest', hint: 'Mondays, only when there is news', right: pref('email', 'digest', notify.prefs.email.digest, 'Weekly digest') },
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

  const privacyRows: RowGroupItem[] = [
    {
      key: 'export',
      icon: 'download-outline',
      label: exporting ? 'Preparing your data…' : 'Export my data',
      hint: 'Everything CareerDeck holds about you, as a file',
      onPress: exporting ? undefined : () => void exportData(),
    },
    {
      key: 'delete',
      icon: 'trash-outline',
      label: deleting ? 'Deleting…' : 'Delete account',
      hint: 'Immediate and permanent',
      onPress: deleting ? undefined : confirmDelete,
    },
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
    { key: 'privacy', title: 'Your data', rows: privacyRows },
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
