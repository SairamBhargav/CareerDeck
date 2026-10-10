import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { STATUS_COLOR, STATUS_LABEL, StatusChip, statusInk } from '@/components/activity/StatusChip';
import { CompanyLogo } from '@/components/common/CompanyLogo';
import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { TourAnchor } from '@/context/TourAnchorContext';
import type { TrackedApplication } from '@/hooks/useApplications';
import type { ApplicationStatus } from '@/types';
import { formatPostedAt } from '@/utils/format';
import { formatWeekLabel, parseLocalDate } from '@/utils/week';

/** Where the application actually went, shown plainly — see ApplicationSource. */
const SOURCE_LABEL: Record<string, string> = {
  greenhouse: 'Greenhouse',
  workday: 'Workday',
  lever: 'Lever',
  ashby: 'Ashby',
  company: 'Company site',
};

/**
 * The one-tap forward move for each stage. Only forward: going backwards is rare enough
 * that it belongs behind the full picker rather than a button you can hit by accident.
 */
const NEXT_STAGE: Partial<Record<ApplicationStatus, { status: ApplicationStatus; label: string }>> = {
  applied: { status: 'interview', label: 'Got an interview' },
  interview: { status: 'offer', label: 'Got an offer' },
};

/** The rail's three stops. `closed` is not one of them: it ends the rail rather than extending it. */
const RAIL: ApplicationStatus[] = ['applied', 'interview', 'offer'];
const RAIL_LABEL: Record<string, string> = { applied: 'Applied', interview: 'Interview', offer: 'Offer' };

interface ApplicationCardProps {
  entry: TrackedApplication;
  onPress: () => void;
  onAdvance: (status: ApplicationStatus) => void;
  onOpenStatusPicker: () => void;
  /**
   * Opens the company. Optional, because the company's own page lists jobs too and a logo
   * there would lead where the reader already is.
   */
  onCompanyPress?: () => void;
  /** Days without a stage change, when it is long enough to say so. */
  quietDays?: number;
}

/**
 * One tracked application: who it is with, how far it has got, and the next move.
 *
 * The rail replaced a lone stage chip (2026-10-09). A chip says where an application is; the
 * rail also says how far that is from the end, which is the thing a reader scanning their
 * season actually wants. The forward move is the card's one primary button, because moving
 * an application along is the only edit that happens often — anything else is in the picker.
 */
export function ApplicationCard({
  entry,
  onPress,
  onAdvance,
  onOpenStatusPicker,
  onCompanyPress,
  quietDays,
}: ApplicationCardProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { application, job } = entry;

  const next = NEXT_STAGE[application.status];
  const reached = RAIL.indexOf(application.status);
  const appliedDate = parseLocalDate(application.appliedAt);

  const logo = (
    <CompanyLogo
      logo={job.companyLogoUrl ?? job.companyLogo}
      name={job.companyName}
      color={job.companyLogoColor ?? undefined}
      size="sm"
    />
  );

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${job.title} at ${job.companyName}, ${STATUS_LABEL[application.status]}`}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}>
      <View style={styles.head}>
        {/* The mark is the company's, so it opens the company — the same everywhere it
            appears. Nested inside the card's Pressable, which the inner one wins. */}
        {onCompanyPress ? (
          <Pressable
            onPress={onCompanyPress}
            accessibilityRole="link"
            accessibilityLabel={`Open ${job.companyName}`}
            hitSlop={6}>
            {logo}
          </Pressable>
        ) : (
          logo
        )}

        <View style={styles.headText}>
          <Text style={styles.title} numberOfLines={1}>
            {job.title}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {job.companyName} · {SOURCE_LABEL[application.source] ?? application.source}
          </Text>
        </View>

        {quietDays !== undefined ? (
          <View style={styles.quiet}>
            <Ionicons name="time-outline" size={11} color={statusInk('interview', colors.surface)} />
            <Text style={[styles.quietText, { color: statusInk('interview', colors.surface) }]}>{quietDays}d quiet</Text>
          </View>
        ) : null}
      </View>

      {application.status === 'closed' ? (
        <View style={styles.closedRow}>
          <StatusChip status="closed" />
          <Text style={styles.closedText}>
            Applied {appliedDate ? formatWeekLabel(appliedDate) : ''} · closed {formatPostedAt(application.updatedAt).toLowerCase()}
          </Text>
        </View>
      ) : (
        <Animated.View key={application.status} entering={FadeIn.duration(200)} style={styles.rail}>
          {RAIL.map((stop, index) => {
            const done = index <= reached;
            const tint = STATUS_COLOR[stop];
            const isCurrent = index === reached;
            return [
              index > 0 ? (
                <View
                  key={`${stop}-line`}
                  style={[styles.railLine, { backgroundColor: done ? tint : colors.border }]}
                />
              ) : null,
              <View key={stop} style={styles.stop}>
                <View
                  style={[
                    styles.dot,
                    done
                      ? { backgroundColor: tint, borderColor: tint }
                      : { backgroundColor: colors.surface, borderColor: colors.borderStrong },
                    isCurrent ? { shadowColor: tint, ...styles.dotCurrent } : null,
                  ]}
                />
                <Text
                  style={[styles.stopLabel, done ? { color: statusInk(stop, colors.surface), fontWeight: '700' } : null]}
                  numberOfLines={1}>
                  {stop === 'applied' && appliedDate ? formatWeekLabel(appliedDate) : RAIL_LABEL[stop]}
                </Text>
              </View>,
            ];
          })}
        </Animated.View>
      )}

      <View style={styles.footer}>
        {next ? (
          // The wrapper carries the flex: outside the tour TourAnchor renders no view of its own.
          <View style={styles.advanceWrap}>
            <TourAnchor id="advance">
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  onAdvance(next.status);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Move ${job.title} to ${STATUS_LABEL[next.status]}`}
                style={({ pressed }) => [styles.advance, pressed ? styles.advancePressed : null]}>
                <Text style={styles.advanceLabel}>{next.label}</Text>
              </Pressable>
            </TourAnchor>
          </View>
        ) : (
          <Text style={styles.settled}>
            {application.status === 'offer' ? `Offer ${formatPostedAt(application.updatedAt).toLowerCase()}` : ''}
          </Text>
        )}

        <Pressable
          onPress={onOpenStatusPicker}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`Change stage for ${job.title}`}
          style={({ pressed }) => [styles.more, pressed ? styles.pressed : null]}>
          <Ionicons name="ellipsis-horizontal" size={16} color={colors.textSecondary} />
        </Pressable>
      </View>
    </Pressable>
  );
}

const DOT = 14;

const useStyles = makeStyles((colors) => ({
  card: {
    gap: spacing.md + 2,
    padding: spacing.lg,
    borderRadius: radius.lg + 2,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  // A background change rather than opacity: opacity would take the company's mark down
  // with the rest of the row, and a logo that dims reads as an image failing to load.
  pressed: {
    backgroundColor: colors.backgroundMuted,
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
  title: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.2,
  },
  meta: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
  },
  quiet: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm + 1,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.backgroundMuted,
  },
  quietText: {
    fontSize: fontSize.caption,
    fontWeight: '800',
  },
  rail: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  // Stops are fixed-width so their labels centre under the dot; the lines take the rest.
  railLine: {
    flex: 1,
    height: 3,
    marginTop: (DOT - 3) / 2,
    borderRadius: 2,
  },
  stop: {
    alignItems: 'center',
    gap: 6,
    width: 64,
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderWidth: 2,
  },
  dotCurrent: {
    shadowOpacity: 0.5,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 0 },
    elevation: 2,
  },
  stopLabel: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    color: colors.textTertiary,
  },
  closedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  closedText: {
    flex: 1,
    fontSize: fontSize.caption,
    color: colors.textTertiary,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  advanceWrap: {
    flex: 1,
  },
  advance: {
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  advancePressed: {
    opacity: 0.85,
  },
  advanceLabel: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.accentText,
  },
  settled: {
    flex: 1,
    fontSize: fontSize.caption + 1,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  more: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
