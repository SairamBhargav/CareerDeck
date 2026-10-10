import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeIn,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { STATUS_COLOR, statusInk } from '@/components/activity/StatusChip';
import { CompanyLogo } from '@/components/common/CompanyLogo';
import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import type { TrackedApplication } from '@/hooks/useApplications';
import { daysQuiet } from '@/hooks/useCheckIns';
import type { ApplicationStatus } from '@/types';
import { hexToRgba } from '@/utils/color';

/** Past this, a released drag throws the card off rather than springing it back. */
const SKIP_THRESHOLD = 96;
const SPRING = { damping: 18, stiffness: 220, mass: 0.7 };

const SOURCE_LABEL: Record<string, string> = {
  greenhouse: 'Greenhouse',
  workday: 'Workday',
  lever: 'Lever',
  ashby: 'Ashby',
  company: 'company site',
};

type Answer = { kind: 'stage'; status: ApplicationStatus } | { kind: 'later' };

interface Choice {
  key: string;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  answer: Answer;
  /** Tinted with this stage's colour; the rest sit on a plain muted fill. */
  tint?: ApplicationStatus;
}

/** What to ask, and the three likely answers, for the stage the application is stuck in. */
function questionFor(entry: TrackedApplication): { title: string; choices: Choice[] } {
  if (entry.application.status === 'interview') {
    return {
      title: 'Still interviewing?',
      choices: [
        { key: 'offer', label: 'Got an offer', icon: 'trophy', answer: { kind: 'stage', status: 'offer' }, tint: 'offer' },
        { key: 'later', label: 'Still going', icon: 'time-outline', answer: { kind: 'later' } },
        { key: 'closed', label: 'It ended', icon: 'close', answer: { kind: 'stage', status: 'closed' } },
      ],
    };
  }
  return {
    title: 'Heard anything back?',
    choices: [
      { key: 'interview', label: 'Interview', icon: 'chatbubbles-outline', answer: { kind: 'stage', status: 'interview' }, tint: 'interview' },
      { key: 'later', label: 'Not yet', icon: 'time-outline', answer: { kind: 'later' } },
      { key: 'closed', label: 'Rejected', icon: 'close', answer: { kind: 'stage', status: 'closed' } },
    ],
  };
}

function detailFor(entry: TrackedApplication, days: number): string {
  return entry.application.status === 'interview'
    ? `No update for ${days} days. Move it along, or tell us it is still going.`
    : `You applied ${days} days ago. Most replies come within 2 weeks.`;
}

interface CheckInStackProps {
  /** Quiet applications, quietest first — `useCheckIns().queue`. */
  queue: TrackedApplication[];
  onSetStatus: (applicationId: string, status: ApplicationStatus) => void;
  /** "Not yet" / "Still going": ask again in a week. */
  onSnooze: (applicationId: string) => void;
  onOpen: (entry: TrackedApplication) => void;
}

/**
 * Activity's check-in: one quiet application at a time, as a card on a little deck.
 *
 * The tracker is self-reported, so it drifts the moment the reader stops tending it. This is
 * the tending, made as cheap as the Deck itself: the three likely answers are buttons, and a
 * card you do not want to answer right now swipes away. Skips only last until the screen is
 * left — the snooze is what "Not yet" is for.
 *
 * Renders nothing when there is nothing to ask, so a tidy tracker costs no space at all.
 */
export function CheckInStack({ queue, onSetStatus, onSnooze, onOpen }: CheckInStackProps) {
  const styles = useStyles();
  const [skipped, setSkipped] = useState<string[]>([]);

  const visible = useMemo(
    () => queue.filter((entry) => !skipped.includes(entry.application.id)),
    [queue, skipped],
  );

  const top = visible[0];
  if (!top) return null;

  const skip = (id: string) => setSkipped((current) => [...current, id]);

  const answer = (entry: TrackedApplication, choice: Answer) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (choice.kind === 'later') onSnooze(entry.application.id);
    else onSetStatus(entry.application.id, choice.status);
  };

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          Quick check-in
        </Text>
        <Text style={styles.count}>
          {queue.length - visible.length + 1} of {queue.length}
        </Text>
      </View>

      <View style={styles.stack}>
        {visible.length > 2 ? <View style={[styles.peek, styles.peekBack]} /> : null}
        {visible.length > 1 ? <View style={[styles.peek, styles.peekMid]} /> : null}
        {/* Keyed on the application, so each card arrives fresh instead of inheriting the
            last one's drag offset. */}
        <CheckInCard
          key={top.application.id}
          entry={top}
          onAnswer={(choice) => answer(top, choice)}
          onSkip={() => skip(top.application.id)}
          onOpen={() => onOpen(top)}
        />
      </View>

      <Text style={styles.hint}>Swipe to skip · keeps your tracker honest</Text>
    </View>
  );
}

interface CheckInCardProps {
  entry: TrackedApplication;
  onAnswer: (answer: Answer) => void;
  onSkip: () => void;
  onOpen: () => void;
}

function CheckInCard({ entry, onAnswer, onSkip, onOpen }: CheckInCardProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const reduced = useReducedMotion();
  const { application, job } = entry;
  const translateX = useSharedValue(0);

  const days = daysQuiet(entry);
  const { title, choices } = questionFor(entry);
  const brand = job.companyLogoColor ?? STATUS_COLOR.applied;

  // Horizontal only, so the page still scrolls through the card.
  const swipe = Gesture.Pan()
    .activeOffsetX([-14, 14])
    .failOffsetY([-12, 12])
    .onUpdate((event) => {
      'worklet';
      translateX.set(event.translationX);
    })
    .onEnd((event) => {
      'worklet';
      if (Math.abs(event.translationX) < SKIP_THRESHOLD) {
        translateX.set(withSpring(0, SPRING));
        return;
      }
      const direction = event.translationX > 0 ? 1 : -1;
      translateX.set(
        withTiming(direction * 480, { duration: 200 }, (finished) => {
          if (finished) runOnJS(onSkip)();
        }),
      );
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { rotate: `${translateX.value / 30}deg` }],
  }));

  return (
    <GestureDetector gesture={swipe}>
      <Animated.View entering={reduced ? undefined : FadeIn.duration(220)} style={[styles.card, cardStyle]}>
        {/* The company's colour, washed in from the top edge — the same signature the Deck's
            reels carry, at a strength that stays out of the text's way. */}
        <Svg style={styles.wash} width="100%" height="100%" pointerEvents="none">
          <Defs>
            <LinearGradient id="checkin-wash" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={brand} stopOpacity={colors.reelWashAlpha + 0.05} />
              <Stop offset="1" stopColor={brand} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#checkin-wash)" />
        </Svg>

        <Pressable
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel={`Open ${job.title} at ${job.companyName}`}
          style={styles.head}>
          <CompanyLogo
            logo={job.companyLogoUrl ?? job.companyLogo}
            name={job.companyName}
            color={job.companyLogoColor ?? undefined}
            size="md"
          />
          <View style={styles.headText}>
            <Text style={styles.company} numberOfLines={1}>
              {job.companyName} · via {SOURCE_LABEL[application.source] ?? application.source}
            </Text>
            <Text style={styles.role} numberOfLines={1}>
              {job.title}
            </Text>
          </View>
        </Pressable>

        <View style={styles.question}>
          <Text style={styles.ask}>{title}</Text>
          <Text style={styles.detail}>{detailFor(entry, days)}</Text>
        </View>

        <View style={styles.choices}>
          {choices.map((choice) => {
            const tint = choice.tint ? STATUS_COLOR[choice.tint] : null;
            const ink = choice.tint ? statusInk(choice.tint, colors.surface) : colors.text;
            return (
              <Pressable
                key={choice.key}
                onPress={() => onAnswer(choice.answer)}
                accessibilityRole="button"
                accessibilityLabel={`${choice.label}, ${job.companyName}`}
                style={({ pressed }) => [
                  styles.choice,
                  tint
                    ? { backgroundColor: hexToRgba(tint, colors.reelWashAlpha + 0.05), borderColor: hexToRgba(tint, 0.35) }
                    : null,
                  pressed ? styles.pressed : null,
                ]}>
                <Ionicons name={choice.icon} size={18} color={tint ?? colors.text} />
                <Text style={[styles.choiceLabel, { color: ink }]} numberOfLines={1}>
                  {choice.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

const PEEK_HEIGHT = 40;

const useStyles = makeStyles((colors) => ({
  section: {
    gap: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: fontSize.title,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.3,
  },
  count: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  // Room underneath for the two cards peeking out from behind.
  stack: {
    paddingBottom: spacing.lg,
  },
  peek: {
    position: 'absolute',
    height: PEEK_HEIGHT,
    borderRadius: radius.xl - 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  peekMid: {
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.sm,
    backgroundColor: colors.surface,
    opacity: 0.8,
  },
  peekBack: {
    left: spacing.xl,
    right: spacing.xl,
    bottom: 0,
    backgroundColor: colors.surface,
    opacity: 0.5,
  },
  card: {
    gap: spacing.lg,
    padding: spacing.lg + 4,
    borderRadius: radius.xl - 2,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    overflow: 'hidden',
    ...colors.shadowLifted,
  },
  wash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 96,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  headText: {
    flex: 1,
    gap: 2,
  },
  company: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  role: {
    fontSize: fontSize.title - 1,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.2,
  },
  question: {
    gap: spacing.xs,
  },
  ask: {
    fontSize: fontSize.heading,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.5,
    lineHeight: 27,
  },
  detail: {
    fontSize: fontSize.small,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  choices: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  choice: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.lg - 2,
    backgroundColor: colors.backgroundMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  choiceLabel: {
    fontSize: fontSize.caption + 1,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.7,
  },
  hint: {
    alignSelf: 'center',
    fontSize: fontSize.caption + 1,
    fontWeight: '600',
    color: colors.textTertiary,
  },
}));
