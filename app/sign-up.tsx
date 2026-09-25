import { useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
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
import Animated, { FadeIn } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/common/PrimaryButton';
import { fontSize, minTapTarget, radius, screenPadding, spacing } from '@/constants/theme';
import { SignInCancelled, useAuth } from '@/context/AuthContext';
import { useOnboarding } from '@/context/OnboardingContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { flushOnboarding } from '@/lib/api';
import { supabase } from '@/lib/supabase';

/** Matches `otp_length` in supabase/config.toml. */
const CODE_LENGTH = 6;

/**
 * The last step: name, email, and — for anyone who said they were a student — school and
 * graduation year.
 *
 * No date of birth. Collecting one would pull in age-gating obligations (COPPA under 13,
 * stricter consent rules elsewhere) and add a P1 field under §13.2, to learn something the
 * graduation year already implies for everything this product does with it.
 *
 * No password either. The app has exactly one credential — a six-digit code by email —
 * and adding a second here would mean two ways in and two ways to lose access.
 *
 * ── What happens after the code is verified ───────────────────────────────────
 *
 * `handle_auth_user_change()` provisions `profiles` and `user_preferences` inside the
 * signup transaction, so by the time `verifyOtp` resolves there are rows to write to.
 * `flushOnboarding` then writes everything the last three screens collected. It never
 * throws: someone who has just signed up should land in the app, not on an error about a
 * preference they can set from Profile in ten seconds.
 */
export default function SignUpScreen() {
  const router = useRouter();
  const styles = useStyles();
  const { colors } = useTheme();
  const { sendEmailCode, verifyEmailCode } = useAuth();
  const onboarding = useOnboarding();

  const [step, setStep] = useState<'details' | 'code'>('details');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [school, setSchool] = useState('');
  const [gradYear, setGradYear] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeInput = useRef<TextInput>(null);

  const asksSchool = onboarding.roleOption?.asksSchool ?? false;
  const emailLooksValid = /^\S+@\S+\.\S+$/.test(email.trim());
  const canSend = emailLooksValid && firstName.trim().length > 0;

  const handleSend = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await sendEmailCode(email);
      setStep('code');
      setCode('');
      requestAnimationFrame(() => codeInput.current?.focus());
    } catch (caught) {
      if (!(caught instanceof SignInCancelled)) setError(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }, [email, sendEmailCode]);

  const handleVerify = useCallback(
    async (value: string) => {
      setBusy(true);
      setError(null);
      try {
        await verifyEmailCode(email, value);

        // The session exists from here. Anything below this line is best-effort.
        const { data } = await supabase.auth.getUser();
        const userId = data.user?.id;

        if (userId) {
          const parsedYear = Number.parseInt(gradYear, 10);
          await flushOnboarding(userId, {
            firstName,
            lastName,
            school: asksSchool ? school : '',
            graduationYear:
              asksSchool && Number.isFinite(parsedYear) && parsedYear > 1950 && parsedYear < 2100
                ? parsedYear
                : null,
            industries: onboarding.industries,
            employmentTypes: onboarding.roleOption?.employmentTypes ?? [],
            followedCompanySlugs: onboarding.followedCompanySlugs,
          });
          onboarding.clear();
        }

        // No navigation: the root layout swaps the whole stack the moment a session
        // lands, so pushing anywhere here would be a race with it.
      } catch (caught) {
        if (!(caught instanceof SignInCancelled)) setError(messageFor(caught));
      } finally {
        setBusy(false);
      }
    },
    [email, verifyEmailCode, firstName, lastName, school, gradYear, asksSchool, onboarding],
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            style={styles.back}>
            <Text style={styles.backGlyph}>‹</Text>
          </Pressable>

          <View style={styles.header}>
            <Text style={styles.eyebrow}>Last step</Text>
            <Text style={styles.title} accessibilityRole="header">
              {step === 'details' ? 'Save your picks.' : 'Check your email.'}
            </Text>
            <Text style={styles.subtitle}>
              {step === 'details'
                ? 'One code by email. No password to remember.'
                : `We sent a six-digit code to ${email.trim()}.`}
            </Text>
          </View>

          {step === 'details' ? (
            <View style={styles.form}>
              <View style={styles.pair}>
                <Field label="First name" value={firstName} onChangeText={setFirstName} autoComplete="given-name" />
                <Field label="Last name" value={lastName} onChangeText={setLastName} autoComplete="family-name" />
              </View>

              <Field
                label="Email"
                value={email}
                onChangeText={setEmail}
                placeholder="you@school.edu"
                keyboardType="email-address"
                autoComplete="email"
              />

              {asksSchool ? (
                <View style={styles.pair}>
                  <Field label="School" value={school} onChangeText={setSchool} placeholder="UT Dallas" />
                  <Field
                    label="Grad year"
                    value={gradYear}
                    onChangeText={(value) => setGradYear(value.replace(/\D/g, '').slice(0, 4))}
                    placeholder="2027"
                    keyboardType="number-pad"
                    narrow
                  />
                </View>
              ) : null}

              <Text style={styles.footnote}>
                Any email works to sign in. A school address unlocks commenting later.
              </Text>
            </View>
          ) : (
            <View style={styles.form}>
              <Text style={styles.label}>Six-digit code</Text>
              <TextInput
                ref={codeInput}
                value={code}
                onChangeText={(value) => {
                  const digits = value.replace(/\D/g, '').slice(0, CODE_LENGTH);
                  setCode(digits);
                  if (digits.length === CODE_LENGTH && !busy) void handleVerify(digits);
                }}
                placeholder="000000"
                placeholderTextColor={colors.textTertiary}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                maxLength={CODE_LENGTH}
                editable={!busy}
                style={[styles.input, styles.codeInput]}
                accessibilityLabel="Six-digit sign-up code"
              />
              <Pressable onPress={() => setStep('details')} hitSlop={8} accessibilityRole="button">
                <Text style={styles.link}>Use a different email</Text>
              </Pressable>
            </View>
          )}

          {error ? (
            <Animated.Text entering={FadeIn.duration(180)} style={styles.error}>
              {error}
            </Animated.Text>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <PrimaryButton
            label={step === 'details' ? 'Send me a code' : 'Continue'}
            onPress={step === 'details' ? () => void handleSend() : () => void handleVerify(code)}
            disabled={step === 'details' ? !canSend : code.length !== CODE_LENGTH}
            loading={busy}
          />
          <Text style={styles.legal}>
            By continuing you agree to CareerDeck&rsquo;s Terms and Privacy Policy.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'email-address' | 'number-pad';
  autoComplete?: 'given-name' | 'family-name' | 'email';
  narrow?: boolean;
}

function Field({ label, value, onChangeText, placeholder, keyboardType, autoComplete, narrow }: FieldProps) {
  const styles = useStyles();
  const { colors } = useTheme();

  return (
    <View style={[styles.field, narrow ? styles.fieldNarrow : null]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        keyboardType={keyboardType ?? 'default'}
        autoComplete={autoComplete}
        autoCapitalize={keyboardType === 'email-address' ? 'none' : 'words'}
        autoCorrect={false}
        style={styles.input}
        accessibilityLabel={label}
      />
    </View>
  );
}

/** Same mapping as the sign-in screen's, for the two errors this screen can raise. */
function messageFor(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();

  if (lower.includes('network') || lower.includes('fetch')) {
    return 'Could not reach the server. Check your connection.';
  }
  if (lower.includes('expired') || lower.includes('invalid') || lower.includes('not found')) {
    return 'That code is wrong or has expired. Ask for a new one.';
  }
  if (lower.includes('rate limit') || lower.includes('too many') || lower.includes('security purposes')) {
    return 'Too many attempts. Wait a minute and try again.';
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
    paddingHorizontal: screenPadding + spacing.md,
    paddingBottom: spacing.xl,
  },
  back: {
    alignSelf: 'flex-start',
    paddingTop: spacing.xs,
  },
  backGlyph: {
    fontSize: 32,
    lineHeight: 34,
    color: colors.textSecondary,
  },
  header: {
    gap: spacing.sm,
    marginTop: spacing.lg,
    marginBottom: spacing.xxl,
  },
  eyebrow: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    color: colors.textTertiary,
  },
  title: {
    fontSize: fontSize.hero,
    fontWeight: '700',
    lineHeight: 38,
    letterSpacing: -1,
    color: colors.text,
  },
  subtitle: {
    fontSize: fontSize.body,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  form: {
    gap: spacing.lg,
  },
  pair: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  field: {
    flex: 1,
    gap: spacing.sm - 1,
  },
  fieldNarrow: {
    flex: 0,
    width: 118,
  },
  label: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textTertiary,
  },
  input: {
    minHeight: minTapTarget + 4,
    paddingHorizontal: spacing.md + 2,
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
  footnote: {
    fontSize: fontSize.small,
    lineHeight: 19,
    color: colors.textTertiary,
  },
  link: {
    fontSize: fontSize.small + 1,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  error: {
    marginTop: spacing.lg,
    fontSize: fontSize.small,
    lineHeight: 18,
    color: colors.like,
  },
  footer: {
    paddingHorizontal: screenPadding + spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  legal: {
    textAlign: 'center',
    fontSize: fontSize.caption + 1,
    lineHeight: 17,
    color: colors.textTertiary,
  },
}));
