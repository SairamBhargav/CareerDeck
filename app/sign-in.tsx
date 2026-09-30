import Ionicons from '@expo/vector-icons/Ionicons';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/common/PrimaryButton';
import { fontSize, minTapTarget, radius, screenPadding, spacing } from '@/constants/theme';
import { SignInCancelled, useAuth } from '@/context/AuthContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';

/** Matches `otp_length` in supabase/config.toml. */
const CODE_LENGTH = 6;

/** The hosted project's minimum gap between codes to one address (Auth → Rate limits). */
const RESEND_SECONDS = 60;

/**
 * Supabase's per-address cooldown: "For security purposes, you can only request this after
 * 47 seconds." Returns the seconds it names, or null when the error is something else.
 * Distinct from the hourly email cap ("email rate limit exceeded"), which a wait of a
 * minute does not fix and so stays an error.
 */
function cooldownSeconds(error: unknown): number | null {
  const raw = error instanceof Error ? error.message : String(error);
  if (!/security purposes/i.test(raw)) return null;
  const match = raw.match(/(\d+)\s*seconds?/i);
  return match ? Number(match[1]) : RESEND_SECONDS;
}

/**
 * The way in. Rendered only when there is no session — see app/_layout.tsx.
 *
 * Three routes to the same place (§15, phase 0): a six-digit code by email, Sign in with
 * Apple, and Google. The email path is the one that works everywhere, including Expo Go
 * with nothing configured beyond a Supabase project, so it leads.
 *
 * Signing up and signing in are the same gesture. §3.2 opens signup to any email address
 * and puts the gate on commenting instead, so there is nothing to choose between here.
 */
export default function SignInScreen() {
  const router = useRouter();
  const styles = useStyles();
  const { colors, scheme } = useTheme();
  const { sendEmailCode, verifyEmailCode, signInWithApple, signInWithGoogle, isAppleAvailable } =
    useAuth();

  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<SignInKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const codeInput = useRef<TextInput>(null);

  const emailLooksValid = /^\S+@\S+\.\S+$/.test(email.trim());

  /**
   * One wrapper around every sign-in path so a provider error can never leave the screen
   * stuck in a spinner, and so backing out of a sheet doesn't read as a failure.
   */
  const run = useCallback(
    async (kind: NonNullable<typeof busy>, action: () => Promise<void>, after?: () => void) => {
      setBusy(kind);
      setError(null);
      try {
        await action();
        after?.();
      } catch (caught) {
        if (caught instanceof SignInCancelled) return;
        setError(messageFor(caught, kind));
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  // Seconds until another code may be requested, and a one-line note under the code box.
  const [cooldown, setCooldown] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const showCodeStep = () => {
    setStep('code');
    setCode('');
    // The keyboard is already up from the email field; moving focus rather than
    // dismissing it keeps the two steps feeling like one form.
    requestAnimationFrame(() => codeInput.current?.focus());
  };

  const handleSendCode = async () => {
    if (busy !== null || cooldown > 0) return;
    setBusy('email');
    setError(null);
    setNotice(null);
    try {
      // `false`: this screen is for people who already have an account, so an unknown
      // address is a wrong turn rather than a signup.
      await sendEmailCode(email, false);
      setCooldown(RESEND_SECONDS);
      showCodeStep();
    } catch (caught) {
      const wait = cooldownSeconds(caught);
      if (wait !== null) {
        // Supabase refuses a second code inside its cooldown, but the first one is still
        // valid and on its way. Say so and put them at the box rather than on an error.
        setCooldown(wait);
        setNotice('We already sent you a code a moment ago. Enter it below.');
        showCodeStep();
      } else if (!(caught instanceof SignInCancelled)) {
        setError(messageFor(caught, 'email'));
      }
    } finally {
      setBusy(null);
    }
  };

  const handleVerify = (value: string) => run('code', () => verifyEmailCode(email, value));

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <Animated.View entering={FadeIn.duration(320)} style={styles.brand}>
            <View style={styles.mark}>
              <Ionicons name="layers" size={26} color={colors.accentText} />
            </View>
            <Text style={styles.wordmark}>CareerDeck</Text>
            <Text style={styles.tagline}>
              Internships and new-grad roles, and the people going for the same ones.
            </Text>
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(300).delay(90)} style={styles.form}>
            {step === 'email' ? (
              <>
                <Text style={styles.label}>Email</Text>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@school.edu"
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  textContentType="emailAddress"
                  inputMode="email"
                  returnKeyType="go"
                  editable={busy === null}
                  onSubmitEditing={() => emailLooksValid && handleSendCode()}
                  style={styles.input}
                  accessibilityLabel="Email address"
                />
                <PrimaryButton
                  label="Email me a code"
                  onPress={handleSendCode}
                  disabled={!emailLooksValid}
                  loading={busy === 'email'}
                />
                <Text style={styles.footnote}>
                  Any email works to sign in. A school address unlocks commenting later.
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.label}>Six-digit code</Text>
                <Text style={styles.sentTo}>{notice ?? `Sent to ${email.trim()}`}</Text>
                <TextInput
                  ref={codeInput}
                  value={code}
                  onChangeText={(value) => {
                    const digits = value.replace(/\D/g, '').slice(0, CODE_LENGTH);
                    setCode(digits);
                    // Deliberately not submitting on the sixth digit. Autofill and fast
                    // typing both overshoot, and a Continue button that fires before
                    // anybody can press it is a button that does nothing — which reads as
                    // the screen having decided for you.
                  }}
                  placeholder="000000"
                  placeholderTextColor={colors.textTertiary}
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  maxLength={CODE_LENGTH}
                  editable={busy === null}
                  style={[styles.input, styles.codeInput]}
                  accessibilityLabel="Six-digit sign-in code"
                />
                <PrimaryButton
                  label="Continue"
                  onPress={() => handleVerify(code)}
                  disabled={code.length !== CODE_LENGTH}
                  loading={busy === 'code'}
                />
                <View style={styles.codeActions}>
                  <Pressable
                    onPress={() => {
                      setStep('email');
                      setError(null);
                    }}
                    hitSlop={8}
                    accessibilityRole="button">
                    <Text style={styles.link}>Use a different email</Text>
                  </Pressable>
                  <Pressable
                    onPress={handleSendCode}
                    hitSlop={8}
                    disabled={busy !== null || cooldown > 0}
                    accessibilityRole="button">
                    <Text style={[styles.link, cooldown > 0 ? styles.linkDisabled : null]}>
                      {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend'}
                    </Text>
                  </Pressable>
                </View>
              </>
            )}

            {error === NO_ACCOUNT ? (
              <Animated.View entering={FadeIn.duration(180)} style={styles.noAccount}>
                <Text style={styles.error}>
                  No account for that email yet.
                </Text>
                <Pressable
                  onPress={() => router.replace('/welcome')}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Create an account">
                  <Text style={styles.noAccountAction}>Create one — it takes a minute</Text>
                </Pressable>
              </Animated.View>
            ) : error ? (
              <Animated.Text entering={FadeIn.duration(180)} style={styles.error}>
                {error}
              </Animated.Text>
            ) : null}
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(300).delay(150)} style={styles.providers}>
            <View style={styles.dividerRow}>
              <View style={styles.divider} />
              <Text style={styles.dividerLabel}>or</Text>
              <View style={styles.divider} />
            </View>

            {isAppleAvailable ? (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                buttonStyle={
                  scheme === 'dark'
                    ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                    : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
                }
                cornerRadius={radius.pill}
                style={styles.appleButton}
                onPress={() => run('apple', signInWithApple)}
              />
            ) : null}

            <Pressable
              onPress={() => run('google', signInWithGoogle)}
              disabled={busy !== null}
              accessibilityRole="button"
              accessibilityLabel="Continue with Google"
              accessibilityState={{ disabled: busy !== null, busy: busy === 'google' }}
              style={({ pressed }) => [
                styles.googleButton,
                pressed ? styles.pressed : null,
                busy !== null ? styles.disabled : null,
              ]}>
              <Ionicons name="logo-google" size={17} color={colors.text} />
              <Text style={styles.googleLabel}>Continue with Google</Text>
            </Pressable>
          </Animated.View>

          <Text style={styles.legal}>
            By continuing you agree to CareerDeck&rsquo;s Terms and Privacy Policy.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Which button is in flight — and, when one fails, which failure is being reported. */
type SignInKind = 'email' | 'code' | 'apple' | 'google';

/**
 * Supabase&rsquo;s auth errors are written for developers. These are the three a user
 * will actually hit; everything else falls through with its own wording rather than
 * being flattened into "Something went wrong", which tells them nothing.
 */
/**
 * Returned when the address has no account. The render checks for it by identity and
 * offers a way to sign up, which is the only error on this screen with somewhere to go.
 */
export const NO_ACCOUNT = 'no-account';

function messageFor(error: unknown, kind: SignInKind): string {
  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();

  // Scoped to the code step. Supabase says "invalid" for several unrelated failures, and
  // telling someone their code is wrong when Google is what actually failed sends them
  // hunting for an email that was never sent.
  if (
    kind === 'code' &&
    (lower.includes('expired') || lower.includes('invalid') || lower.includes('not found'))
  ) {
    return 'That code is wrong or has expired. Ask for a new one.';
  }
  /*
   * What `shouldCreateUser: false` returns for an address with no account. Supabase
   * phrases it as signups being disallowed, which is true of this call and useless to
   * read, so it becomes the one error here that has an answer attached.
   */
  if (kind === 'email' && (lower.includes('signups not allowed') || lower.includes('signup is disabled') || lower.includes('user not found'))) {
    return NO_ACCOUNT;
  }
  if (lower.includes('rate limit') || lower.includes('too many') || lower.includes('security purposes')) {
    return kind === 'email'
      ? 'Too many codes requested for now. Try again in a little while, or use Apple or Google.'
      : 'Too many attempts. Wait a minute and try again.';
  }
  if (lower.includes('network') || lower.includes('fetch')) {
    return 'Could not reach the server. Check your connection.';
  }
  return raw;
}

const useStyles = makeStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: screenPadding,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xl,
    gap: spacing.xl,
  },
  brand: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  mark: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  wordmark: {
    fontSize: fontSize.display,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.8,
  },
  tagline: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
    maxWidth: 300,
  },
  form: {
    gap: spacing.md,
  },
  label: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textTertiary,
  },
  sentTo: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
    marginTop: -spacing.sm,
  },
  input: {
    minHeight: minTapTarget,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? spacing.md : spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.backgroundMuted,
    color: colors.text,
    fontSize: fontSize.body,
  },
  codeInput: {
    fontSize: fontSize.heading,
    fontWeight: '700',
    letterSpacing: 8,
    textAlign: 'center',
  },
  codeActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  link: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  linkDisabled: {
    color: colors.textTertiary,
  },
  footnote: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    lineHeight: 18,
  },
  noAccount: {
    gap: spacing.xs,
  },
  noAccountAction: {
    fontSize: fontSize.small + 1,
    fontWeight: '700',
    color: colors.accent,
  },
  error: {
    fontSize: fontSize.small,
    color: colors.like,
    lineHeight: 18,
  },
  providers: {
    gap: spacing.md,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  divider: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  dividerLabel: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  appleButton: {
    height: minTapTarget + 4,
  },
  googleButton: {
    minHeight: minTapTarget + 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  googleLabel: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.text,
  },
  pressed: {
    opacity: 0.75,
  },
  disabled: {
    opacity: 0.45,
  },
  legal: {
    marginTop: 'auto',
    fontSize: fontSize.caption + 1,
    color: colors.textTertiary,
    textAlign: 'center',
    lineHeight: 17,
  },
}));
