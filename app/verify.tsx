import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IconButton } from '@/components/common/IconButton';
import { PrimaryButton } from '@/components/common/PrimaryButton';
import { fontSize, minTapTarget, radius, screenPadding, spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useVerification } from '@/hooks/useVerification';
import { ServiceError, ServiceUnavailable } from '@/lib/service';

/**
 * Verification — the school-email path, as one screen.
 *
 * What this screen does *not* say is "verify to unlock CareerDeck". Verification unlocks
 * commenting and nothing else — the feed, search, liking, applying and the tracker all work on a
 * plain email account (§3.2's tier table) — and implying otherwise would be a dark pattern in
 * service of collecting school addresses.
 *
 * ── The government ID path is not offered at the moment ───────────────────────
 *
 * §3.2 makes `edu` and `identity` siblings rather than a hierarchy: both grant comment-write and
 * they differ only in the badge. This screen used to offer both at once, as peers, for a specific
 * reason — the bootcamp grad, the career switcher, and the student whose university uses a
 * `.ac.uk`-style domain have no `.edu` address to give, and the ID check was how they got in.
 *
 * Offering it is on hold, which means those people cannot comment yet. Worth naming rather than
 * leaving to be discovered: somebody whose school is not on our domain list now reaches a dead end
 * here, and the `domain_not_recognised` copy can only tell them to check back.
 *
 * Nothing underneath was removed. `startIdentity` (useVerification), `startIdentityVerification`
 * (lib/api) and the server route are intact, so restoring the path is UI work; and the comment gate
 * still honours the `identity` tier, so an account already verified that way keeps its badge and
 * its access — that tier is simply no longer reachable from this screen.
 */
export default function VerifyScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useStyles();
  const { userId } = useAuth();
  const verification = useVerification(userId);

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  /** Set once a code has been sent this session, which is what swaps the form for the code box. */
  const [sentTo, setSentTo] = useState<{ email: string; school: string; devCode?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const explain = (cause: unknown): string => {
    if (cause instanceof ServiceUnavailable) {
      return 'Verification is not available on this build.';
    }
    if (cause instanceof ServiceError) {
      switch (cause.code) {
        case 'domain_not_recognised':
          return 'We do not have that school on file yet. We are still adding schools — check back soon.';
        case 'address_in_use':
          return 'That address has already verified another account.';
        case 'credential_blocked':
          return 'That address cannot be used to verify an account.';
        case 'too_many_attempts':
          return 'Too many attempts. Wait a few minutes and try again.';
        case 'bad_code':
          return 'That code is wrong or has expired.';
        case 'offline':
          return 'Could not reach CareerDeck. Check your connection and try again.';
        default:
          return cause.message;
      }
    }
    return 'That did not work. Try again.';
  };

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const challenge = await verification.startEdu(email.trim());
      setSentTo({
        email: email.trim(),
        school: challenge.school,
        ...(challenge.devCode === undefined ? {} : { devCode: challenge.devCode }),
      });
    } catch (cause) {
      setError(explain(cause));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await verification.confirmEdu(code.trim());
      // Straight back to wherever they came from. The badge is now on their profile and the
      // composer is open; a success screen would be a screen to dismiss.
      router.back();
    } catch (cause) {
      setError(explain(cause));
    } finally {
      setBusy(false);
    }
  };

  const verified = verification.canComment;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <View style={styles.topBar}>
        <IconButton name="chevron-back" accessibilityLabel="Go back" onPress={() => router.back()} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.heading}>
          <Text style={styles.title} accessibilityRole="header">
            {verified ? 'You are verified' : 'Join the conversation'}
          </Text>
          <Text style={styles.subtitle}>
            {verified
              ? 'You can comment on postings. Your comments never show your name or your email.'
              : 'Verifying lets you comment on postings. Everything else in CareerDeck already works without it.'}
          </Text>
        </View>

        {verified ? (
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Ionicons name="shield-checkmark" size={20} color={colors.goalMet} />
              <Text style={styles.cardTitle}>
                {verification.tier === 'edu' ? 'School email confirmed' : 'Identity confirmed'}
              </Text>
            </View>
            <Text style={styles.cardBody}>
              {verification.badge
                ? `Your comments show "${verification.badge}" and the name ${verification.handle ?? ''}.`
                : `Your comments show a Verified badge and the name ${verification.handle ?? ''}. Nothing else about you is shown.`}
            </Text>
            {verification.eduExpiresAt ? (
              // §3.2: school addresses die after graduation, so this is stated up front rather
              // than arriving as a surprise notification in two years.
              <Text style={styles.cardNote}>
                School addresses need re-confirming around{' '}
                {new Date(verification.eduExpiresAt).toLocaleDateString()}. We will remind you before
                then.
              </Text>
            ) : null}
          </View>
        ) : null}

        {!verification.isConfigured ? (
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <Ionicons name="construct-outline" size={20} color={colors.textSecondary} />
              <Text style={styles.cardTitle}>Not available on this build</Text>
            </View>
            <Text style={styles.cardBody}>
              Verification needs the CareerDeck API service, which this build is not pointed at. Set
              EXPO_PUBLIC_API_URL and restart with --clear.
            </Text>
          </View>
        ) : null}

        {!verified && verification.isConfigured ? (
          <View style={styles.card}>
            {sentTo === null ? (
              <>
                <Text style={styles.cardBody}>
                  Use your university address. We send a code, and your comments then show your
                  major, school and year — never your name or the address itself.
                </Text>
                <TextInput
                  value={email}
                  onChangeText={(text) => {
                    setEmail(text);
                    if (error !== null) setError(null);
                  }}
                  placeholder="you@university.edu"
                  placeholderTextColor={colors.textTertiary}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  style={styles.input}
                  accessibilityLabel="Your school email address"
                />
                <PrimaryButton
                  label="Send me a code"
                  onPress={() => void send()}
                  disabled={email.trim().length < 5 || busy}
                  loading={busy}
                />
              </>
            ) : (
              <>
                <Text style={styles.cardBody}>
                  We sent a six-digit code to {sentTo.email}. It is good for 30 minutes.
                </Text>
                {/* Only a development server with no mail provider returns the code. Shown here so
                    the flow is usable on a fresh clone; a production server refuses that path. */}
                {sentTo.devCode ? (
                  <Text style={styles.devCode}>Development server — your code is {sentTo.devCode}</Text>
                ) : null}
                <TextInput
                  value={code}
                  onChangeText={(text) => {
                    setCode(text.replace(/\D/g, '').slice(0, 6));
                    if (error !== null) setError(null);
                  }}
                  placeholder="000000"
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  style={[styles.input, styles.codeInput]}
                  accessibilityLabel="The six-digit code we emailed you"
                />
                <PrimaryButton
                  label={`Confirm ${sentTo.school}`}
                  onPress={() => void confirm()}
                  disabled={code.length !== 6 || busy}
                  loading={busy}
                />
                <PrimaryButton
                  label="Use a different address"
                  variant="ghost"
                  onPress={() => {
                    setSentTo(null);
                    setCode('');
                    setError(null);
                  }}
                />
              </>
            )}
          </View>
        ) : null}

        {error ? (
          <View style={styles.error}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.like} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <Text style={styles.footnote}>
          Comments are anonymous to other people and tied to your account for us. That is what lets
          moderation work, and it is why a ban cannot be undone with a new signup.
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
  topBar: {
    // A row, like every other top bar in the app. Without it this View stretches its one
    // child, and IconButton centres its glyph inside whatever width it is given — so the
    // back arrow sat in the middle of the screen.
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: screenPadding,
    paddingTop: spacing.sm,
  },
  content: {
    paddingHorizontal: screenPadding,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
  heading: {
    paddingTop: spacing.sm,
    gap: 6,
  },
  title: {
    fontSize: fontSize.display,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.7,
  },
  subtitle: {
    fontSize: fontSize.small,
    lineHeight: 20,
    color: colors.textTertiary,
  },
  card: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  cardTitle: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.text,
  },
  cardBody: {
    fontSize: fontSize.small,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  cardNote: {
    fontSize: fontSize.caption,
    lineHeight: 17,
    color: colors.textTertiary,
  },
  input: {
    minHeight: minTapTarget,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.backgroundMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    color: colors.text,
    fontSize: fontSize.body,
  },
  codeInput: {
    textAlign: 'center',
    letterSpacing: 8,
    fontSize: fontSize.title,
    fontWeight: '700',
  },
  devCode: {
    fontSize: fontSize.caption,
    color: colors.textTertiary,
    fontWeight: '700',
  },
  error: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  errorText: {
    flex: 1,
    fontSize: fontSize.small,
    lineHeight: 19,
    color: colors.like,
    fontWeight: '600',
  },
  footnote: {
    fontSize: fontSize.caption,
    lineHeight: 17,
    color: colors.textTertiary,
  },
}));
