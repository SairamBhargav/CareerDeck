import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Circle, Svg } from 'react-native-svg';

import { AnimatedCount } from '@/components/common/AnimatedCount';
import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import type { User } from '@/types';
import { initialsOf, studyLineOf } from '@/utils/profile';

const AVATAR_SIZE = 84;
const RING_STROKE = 3;
const RING_RADIUS = (AVATAR_SIZE + RING_STROKE * 3) / 2;
const RING_BOX = RING_RADIUS * 2 + RING_STROKE;
/** Per-line stagger down the identity block. */
const STAGGER_MS = 50;

interface ProfileHeaderProps {
  user: User;
  /**
   * `CS @ Purdue '27` once a school email is confirmed, "Verified" on the ID path, null otherwise.
   *
   * Composed by the database from the school the account actually verified — never from the
   * free-text school on the profile, which is why the header cannot build it itself. §3.1.
   */
  commentBadge?: string | null;
  /** Opens the verification screen. Shown only while there is no badge to show. */
  onVerify?: () => void;
  /** Weeks at goal in a row. A ring is drawn around the avatar only while this is live. */
  streakWeeks: number;
  applications: number;
  autoApplyCredits: number;
  onEdit: () => void;
}

/**
 * Who the user is, and how their season is going.
 *
 * The three figures underneath used to live as rows in the list below — buried among
 * follow counts, which made "how am I actually doing" a thing you had to go and read.
 * They belong beside the name, and they're the same numbers Activity leads on rather
 * than a second tally that can drift away from it.
 */
export function ProfileHeader({
  user,
  commentBadge = null,
  onVerify,
  streakWeeks,
  applications,
  autoApplyCredits,
  onEdit,
}: ProfileHeaderProps) {
  const { colors } = useTheme();
  const styles = useStyles();

  const onStreak = streakWeeks > 0;
  // A brand-new account has an email and nothing else — §3.2 asks for nothing more at
  // signup. Each line below appears only once there is something to put in it, rather
  // than rendering an empty row or "Class of 0".
  const initials = initialsOf(user);
  const studyLine = studyLineOf(user);

  /*
   * The badge, or a way to get one. Never both, and never an empty space where one would be.
   *
   * This is the only place in the app that shows the user their own comment identity, and showing
   * it here rather than only on a comment is deliberate: the badge is composed from a *verified*
   * school, so somebody who typed "Purdue" into their profile and never verified needs to see that
   * their comments will not say Purdue.
   */
  const verifyPrompt = commentBadge === null && onVerify !== undefined;

  return (
    <View style={styles.wrap}>
      <Animated.View entering={FadeIn.duration(300)} style={styles.avatarWrap}>
        {/* A closed ring, not a gauge: the streak is either running or it isn't, and
            there's no partial state worth drawing at this size. */}
        {onStreak ? (
          <Svg width={RING_BOX} height={RING_BOX} style={styles.ring}>
            <Circle
              cx={RING_BOX / 2}
              cy={RING_BOX / 2}
              r={RING_RADIUS}
              stroke={colors.goalMet}
              strokeWidth={RING_STROKE}
              fill="none"
            />
          </Svg>
        ) : null}

        <View style={styles.avatar}>
          {initials ? (
            <Text style={styles.avatarText}>{initials}</Text>
          ) : (
            <Ionicons name="person" size={34} color={colors.accentText} />
          )}
        </View>

        {onStreak ? (
          <Animated.View entering={FadeIn.duration(320).delay(180)} style={styles.flame}>
            <Ionicons name="flame" size={11} color={colors.textOnBrand} />
            <Text style={styles.flameText}>{streakWeeks}</Text>
          </Animated.View>
        ) : null}
      </Animated.View>

      <Animated.View entering={FadeInDown.duration(280).delay(STAGGER_MS)} style={styles.identity}>
        <View style={styles.nameRow}>
          <Text style={[styles.name, user.displayName ? null : styles.namePlaceholder]}>
            {user.displayName || 'Add your name'}
          </Text>
          <Pressable
            onPress={onEdit}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Edit your profile"
            style={({ pressed }) => [styles.editButton, pressed ? styles.pressed : null]}>
            <Ionicons name="pencil" size={12} color={colors.textSecondary} />
            <Text style={styles.editLabel}>Edit</Text>
          </Pressable>
        </View>

        {user.school ? <Text style={styles.detail}>{user.school}</Text> : null}
        {studyLine ? <Text style={styles.detail}>{studyLine}</Text> : null}
        {user.location ? <Text style={styles.detail}>{user.location}</Text> : null}

        {commentBadge !== null ? (
          <View style={styles.badge}>
            <Ionicons name="shield-checkmark" size={12} color={colors.goalMet} />
            <Text style={styles.badgeLabel}>{commentBadge}</Text>
          </View>
        ) : verifyPrompt ? (
          <Pressable
            onPress={onVerify}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Verify your account so you can comment on postings"
            style={({ pressed }) => [styles.verify, pressed ? styles.pressed : null]}>
            <Ionicons name="shield-outline" size={12} color={colors.textSecondary} />
            <Text style={styles.verifyLabel}>Verify to comment</Text>
            <Ionicons name="chevron-forward" size={12} color={colors.textTertiary} />
          </Pressable>
        ) : null}
      </Animated.View>

      <Animated.View entering={FadeInDown.duration(300).delay(STAGGER_MS * 2)} style={styles.stats}>
        <Stat
          value={streakWeeks}
          label={streakWeeks === 1 ? 'week streak' : 'weeks streak'}
          tint={onStreak ? colors.goalMet : undefined}
          first
        />
        <Stat value={applications} label="applications" />
        <Stat value={autoApplyCredits} label="auto applies" tint={colors.autoApply} />
      </Animated.View>
    </View>
  );
}

interface StatProps {
  value: number;
  label: string;
  /** Colours the figure when it means something — a live streak, credits in hand. */
  tint?: string;
  /** The leading stat has no divider to its left. */
  first?: boolean;
}

function Stat({ value, label, tint, first = false }: StatProps) {
  const styles = useStyles();

  return (
    <View style={[styles.stat, first ? styles.statFirst : null]}>
      <AnimatedCount value={value} style={tint ? [styles.statValue, { color: tint }] : styles.statValue} />
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  /*
   * The badge reads as a credential rather than as another profile line: a pill with the
   * verification tick, set apart from the free-text school above it. The distinction matters here
   * more than anywhere else on this screen, because one of those lines is what the user typed and
   * the other is what the database will vouch for.
   */
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'center',
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.backgroundMuted,
  },
  badgeLabel: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    color: colors.text,
  },
  verify: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'center',
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
  },
  verifyLabel: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  wrap: {
    alignItems: 'center',
    gap: spacing.lg,
  },
  avatarWrap: {
    width: RING_BOX,
    height: RING_BOX,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: colors.accentText,
    fontSize: fontSize.heading + 2,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  // Sits on the ring at the bottom, the way a badge sits on an avatar elsewhere —
  // close enough to read as part of it rather than as a floating chip.
  flame: {
    position: 'absolute',
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.goalMet,
    borderWidth: 2,
    borderColor: colors.background,
  },
  flameText: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.textOnBrand,
  },
  identity: {
    alignItems: 'center',
    gap: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  name: {
    fontSize: fontSize.heading,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.4,
  },
  namePlaceholder: {
    color: colors.textTertiary,
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm + 1,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.backgroundMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  editLabel: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  pressed: {
    opacity: 0.6,
  },
  detail: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
  },
  stats: {
    flexDirection: 'row',
    alignSelf: 'stretch',
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    gap: 1,
    // Hairlines between the three rather than around each: one object, divided.
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.border,
  },
  statFirst: {
    borderLeftWidth: 0,
  },
  statValue: {
    fontSize: fontSize.heading,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.5,
  },
  statLabel: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    color: colors.textTertiary,
  },
}));
