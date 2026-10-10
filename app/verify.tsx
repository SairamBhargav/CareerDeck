import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { type ComponentProps, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  useReducedMotion,
  ZoomIn,
} from 'react-native-reanimated';
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
type EnteringAnimation = ComponentProps<typeof Animated.View>['entering'];

export default function VerifyScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useStyles();
  const { userId } = useAuth();
  const verification = useVerification(userId);
  const reduced = useReducedMotion();

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
  /** Which of the three states the screen is in. The hero and the heading both follow it. */
  const stage: HeroKind = verified ? 'verified' : sentTo === null ? 'start' : 'code';

  /** Entrance choreography: the mark lands, then the words, then what there is to do. */
  const enter = (delay: number): EnteringAnimation =>
    reduced ? FadeIn.duration(200) : FadeInDown.duration(500).delay(delay).springify().dampingRatio(0.86);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <View style={styles.topBar}>
        <IconButton name="chevron-back" accessibilityLabel="Go back" onPress={() => router.back()} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Keyed on the stage so the mark replays its entrance when the screen moves on, rather
            than swapping glyph silently underneath a circle that never moves. */}
        <Hero key={stage} kind={stage} />

        <View style={styles.heading}>
          <Animated.Text entering={enter(140)} style={styles.title} accessibilityRole="header">
            {verified
              ? 'You are verified'
              : stage === 'code'
                ? 'Check your email'
                : 'Join the conversation'}
          </Animated.Text>
          <Animated.Text entering={enter(200)} style={styles.subtitle}>
            {verified
              ? 'You can comment on postings. Your comments never show your name or your email.'
              : stage === 'code'
                ? `A six-digit code is on its way to ${sentTo?.email ?? ''}. It is good for 30 minutes.`
                : 'Verifying lets you comment on postings. Everything else in CareerDeck already works without it.'}
          </Animated.Text>
        </View>

        {/*
          What it gets you, before the form asks for anything.

          The screen used to open on a title and an email box, which reads as a toll gate: you
          cannot tell what you are buying until after you have paid. These are the three things
          verifying changes, in the order somebody would ask about them — what opens up, who they
          appear as, and what stays private. They go away once a code is out, because by then the
          decision is made and the only thing that matters is the box.
        */}
        {stage === 'start' && verification.isConfigured ? (
          <View style={styles.benefits}>
            <Benefit
              delay={280}
              icon="chatbubble-ellipses-outline"
              title="Comment on any posting"
              note="Ask what the process was really like, and answer it for the next person."
            />
            <Benefit
              delay={350}
              icon="school-outline"
              title="You appear as your major, school and year"
              note="That is the whole of your byline, taken from the address you confirm."
            />
            <Benefit
              delay={420}
              icon="eye-off-outline"
              title="Your name and address are never shown"
              note="Other people see the badge and nothing behind it."
            />
          </View>
        ) : null}

        {verified ? (
          <Animated.View entering={enter(260)} style={styles.card}>
            <View style={styles.cardHead}>
              <Ionicons name="shield-checkmark" size={20} color={colors.goalMet} />
              <Text style={styles.cardTitle}>
                {verification.tier === 'edu' ? 'School email confirmed' : 'Identity confirmed'}
              </Text>
            </View>
            <Text style={styles.cardBody}>
              {verification.badge
                ? `Your comments show your blob and "${verification.badge}". Nothing else about you is shown.`
                : 'Your comments show your blob and "Verified member". Nothing else about you is shown.'}
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
          </Animated.View>
        ) : null}

        {!verification.isConfigured ? (
          <Animated.View entering={enter(260)} style={styles.card}>
            <View style={styles.cardHead}>
              <Ionicons name="construct-outline" size={20} color={colors.textSecondary} />
              <Text style={styles.cardTitle}>Not available on this build</Text>
            </View>
            <Text style={styles.cardBody}>
              Verification needs the CareerDeck API service, which this build is not pointed at. Set
              EXPO_PUBLIC_API_URL and restart with --clear.
            </Text>
          </Animated.View>
        ) : null}

        {!verified && verification.isConfigured ? (
          <Animated.View entering={enter(stage === 'code' ? 260 : 500)} style={styles.card}>
            {sentTo === null ? (
              <>
                <Text style={styles.cardLabel}>School email</Text>
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
          </Animated.View>
        ) : null}

        {error ? (
          <Animated.View entering={FadeIn.duration(180)} style={styles.error}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.like} />
            <Text style={styles.errorText}>{error}</Text>
          </Animated.View>
        ) : null}

        <Text style={styles.footnote}>
          Comments are anonymous to other people and tied to your account for us. That is what lets
          moderation work, and it is why a ban cannot be undone with a new signup.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

type HeroKind = 'start' | 'code' | 'verified';

/**
 * The mark at the top of the screen.
 *
 * The page opened on a title and an input, which is a form rather than a place — nothing held
 * the top of it. This is the same ink disc the app fills a selected chip and the tab bar's active
 * mark with, at the size where it reads as an anchor, and it follows the stage so the screen
 * visibly moves: bubbles while this is still an invitation, an opened envelope once a code is out,
 * the shield once it is done.
 *
 * The finished state is the only one that takes a colour, and it takes the one the app already
 * uses for a goal that has been met. Nothing here borrows Auto Apply's violet: that colour means
 * "paid" everywhere else, and verifying is free.
 */
function Hero({ kind }: { kind: HeroKind }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const reduced = useReducedMotion();

  const done = kind === 'verified';

  return (
    <Animated.View
      entering={
        reduced ? FadeIn.duration(200) : ZoomIn.duration(420).delay(80).springify().dampingRatio(0.62)
      }
      style={[styles.heroDisc, done ? styles.heroDiscDone : null]}>
      <Ionicons
        name={done ? 'shield-checkmark' : kind === 'code' ? 'mail-open' : 'chatbubbles'}
        size={28}
        color={done ? colors.goalMet : colors.accentText}
      />
    </Animated.View>
  );
}

interface BenefitProps {
  icon: ComponentProps<typeof Ionicons>['name'];
  title: string;
  note: string;
  delay: number;
}

/** One of the three things verifying changes: an icon chip, the claim, and the detail under it. */
function Benefit({ icon, title, note, delay }: BenefitProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const reduced = useReducedMotion();

  return (
    <Animated.View
      entering={
        reduced ? FadeIn.duration(200) : FadeInDown.duration(460).delay(delay).springify().dampingRatio(0.9)
      }
      style={styles.benefit}>
      <View style={styles.benefitIcon}>
        <Ionicons name={icon} size={15} color={colors.text} />
      </View>
      <View style={styles.benefitText}>
        <Text style={styles.benefitTitle}>{title}</Text>
        <Text style={styles.benefitNote}>{note}</Text>
      </View>
    </Animated.View>
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
  heroDisc: {
    width: 60,
    height: 60,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    marginTop: spacing.sm,
  },
  heroDiscDone: {
    backgroundColor: colors.goalMetSurface,
  },
  heading: {
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
  benefits: {
    // Its own band rather than a card: three facts about the app, not a control to operate.
    gap: spacing.lg,
    paddingVertical: spacing.xs,
  },
  benefit: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  benefitIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backgroundMuted,
  },
  benefitText: {
    flex: 1,
    gap: 2,
    // Optical: the title's cap height sits a little above the centre of its chip otherwise.
    paddingTop: 4,
  },
  benefitTitle: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.text,
  },
  benefitNote: {
    fontSize: fontSize.caption,
    lineHeight: 17,
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
  cardLabel: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.textTertiary,
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
