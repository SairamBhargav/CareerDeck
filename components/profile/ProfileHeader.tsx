import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AnimatedBlobatar } from '@blobatar/react-native/animated';
import Animated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { Circle, Svg } from 'react-native-svg';

import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import type { User } from '@/types';
import { studyLineOf } from '@/utils/profile';

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
  /**
   * Weeks at goal in a row.
   *
   * Stays after the figures moved to Activity, because the ring around the avatar and the
   * flame on it are drawn from this — it is part of the portrait rather than part of the
   * readout that left.
   */
  streakWeeks: number;
  onEdit: () => void;
}

/**
 * Who the user is.
 *
 * The figures that used to sit under the name — streak, applications, credits, follows —
 * moved to Activity, which is the screen about how a season is going. What is left is
 * identity: the avatar, the name, the course, and the badge that says a school vouched
 * for the account.
 *
 * The streak ring stays, because it is drawn on the portrait rather than listed beside it.
 */
export function ProfileHeader({
  user,
  commentBadge = null,
  onVerify,
  streakWeeks,
  onEdit,
}: ProfileHeaderProps) {
  const { colors } = useTheme();
  const styles = useStyles();

  const onStreak = streakWeeks > 0;
  // A brand-new account has an email and nothing else — §3.2 asks for nothing more at
  // signup. Each line below appears only once there is something to put in it, rather
  // than rendering an empty row or "Class of 0".
  const studyLine = studyLineOf(user);
  const reduceMotion = useReducedMotion();

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

        {/* The one large avatar in the app, so the one that breathes and blinks — unless the
            phone asks for reduced motion. Seeded from the pseudonym, as everywhere else. */}
        <View style={styles.avatar}>
          <AnimatedBlobatar name={user?.handle || 'careerdeck'} size={AVATAR_SIZE * 0.86} animate={!reduceMotion} />
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
    backgroundColor: colors.backgroundMuted,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
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
    // Hairlines between them rather than around each: one object, divided.
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.border,
  },
  statFirst: {
    borderLeftWidth: 0,
  },
  statPressed: {
    opacity: 0.6,
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
