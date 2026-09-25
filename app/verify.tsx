import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IconButton } from '@/components/common/IconButton';
import { PrimaryButton } from '@/components/common/PrimaryButton';
import { SectionHeader } from '@/components/common/SectionHeader';
import { fontSize, minTapTarget, radius, screenPadding, spacing } from '@/constants/theme';
import { useAuth } from '@/context/AuthContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useVerification } from '@/hooks/useVerification';
import { ServiceError, ServiceUnavailable } from '@/lib/service';

/**
 * Verification — README §3.2's two-path ladder, as one screen.
 *
 * The single most important thing about this screen is that **both paths are offered at once**. §3.2:
 * *"`edu` and `identity` are siblings, not a hierarchy — both grant comment-write. They differ only
 * in the badge. This matters for the bootcamp grad, the career switcher, and the student whose
 * university uses a `.ac.uk`-style domain: they get in via the ID path."*
 *
 * The obvious design — ask for a school email, and offer the ID check only when that fails — would
 * quietly exclude exactly those people, because somebody without a `.edu` address has no reason to
 * try one and will read the screen as "this is for students" and leave. So the second path is a peer
 * on the page, not a fallback behind an error.
 *
 * What it does *not* say is "verify to unlock CareerDeck". Verification unlocks commenting and
 * nothing else — the feed, search, saving, applying and the tracker all work on a plain email
 * account (§3.2's tier table) — and implying otherwise would be a dark pattern in service of
 * collecting government IDs.
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
  /** Set when the domain is not a registered school — the moment to point at the other path. */
  const [suggestIdPath, setSuggestIdPath] = useState(false);

  const explain = (cause: unknown): string => {
    if (cause instanceof ServiceUnavailable) {
      return 'Verification is not available on this build.';
    }
    if (cause instanceof ServiceError) {
      switch (cause.code) {
        case 'domain_not_recognised':
          return 'We do not have that school on file yet. You can verify with a government ID instead — it works exactly the same.';
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
    setSuggestIdPath(false);
    try {
      const challenge = await verification.startEdu(email.trim());
      setSentTo({
        email: email.trim(),
        school: challenge.school,
        ...(challenge.devCode === undefined ? {} : { devCode: challenge.devCode }),
      });
    } catch (cause) {
      setError(explain(cause));
      if (cause instanceof ServiceError && cause.code === 'domain_not_recognised') {
        setSuggestIdPath(true);
      }
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

  const openIdCheck = async () => {
    setBusy(true);
    setError(null);
    try {
      await verification.startIdentity();
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
                {new Date(verification.eduExpiresAt).toLocaleDateString()}. We will remind you, and
                you can switch to a government ID instead.
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
          <>
            <SectionHeader title="With a school email" />
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

            {/*
              Not "or", and not smaller. §3.2 makes these siblings, and the layout has to agree:
              somebody with no .edu address should read this as the route meant for them, not as
              the consolation prize under the real one.
            */}
            <SectionHeader title="Or with a government ID" />
            <View style={[styles.card, suggestIdPath ? styles.cardHighlighted : null]}>
              <Text style={styles.cardBody}>
                For bootcamp grads, career switchers, and anyone whose university is not on our list.
                A verification partner checks that you are a real person — CareerDeck never sees or
                stores the document, only whether the check passed.
              </Text>
              <Text style={styles.cardNote}>
                Your comments then show a Verified badge and nothing about where you studied.
              </Text>
              <PrimaryButton
                label="Verify with an ID"
                variant="secondary"
                onPress={() => void openIdCheck()}
                disabled={busy}
              />
            </View>
          </>
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
  // Only when the .edu attempt was refused for an unknown domain — the one moment this path is
  // genuinely the answer rather than merely the alternative.
  cardHighlighted: {
    borderColor: colors.borderStrong,
    backgroundColor: colors.backgroundMuted,
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
