import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, useAnimatedStyle, useDerivedValue, withTiming } from 'react-native-reanimated';

import { STATUS_COLOR, STATUS_LABEL } from '@/components/activity/StatusChip';
import { AnimatedCount } from '@/components/common/AnimatedCount';
import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';
import type { PipelineCounts } from '@/hooks/useApplications';
import type { ApplicationStatus } from '@/types';

const STAGES: ApplicationStatus[] = ['applied', 'interview', 'offer', 'closed'];

const BAR_HEIGHT = 14;
/**
 * Segments are separated by a gap in the page background rather than a stroke around
 * each one — a border adds ink that isn't data, and at this height it would swallow
 * the thinnest segment entirely.
 */
const SEGMENT_GAP = 2;
const GROW_MS = 520;
/** Per-tile stagger on the legend below the bar. */
const STAGGER_MS = 55;

interface PipelineChartProps {
  counts: PipelineCounts;
}

/**
 * The season at a glance: how many applications exist, how many moved past the pile,
 * and how the whole set breaks down by stage.
 *
 * Part-to-whole, so it's a stacked bar — every application sits in exactly one stage,
 * and the question the strip answers is "what does my pile look like", not "how has it
 * changed". The tiles under it are the legend: status colour never carries meaning on
 * its own here, it's always beside a label and a figure.
 */
export function PipelineChart({ counts }: PipelineChartProps) {
  const styles = useStyles();

  // Of everything submitted, how much got a human response. Closed applications stay
  // in the denominator on purpose — a rejection after an interview still counts as
  // having moved, and dropping them would quietly inflate the rate.
  const movedForward = counts.interview + counts.offer;
  const responseRate = counts.total > 0 ? Math.round((movedForward / counts.total) * 100) : 0;

  return (
    <View style={styles.card}>
      <View style={styles.headline}>
        <View style={styles.hero}>
          <AnimatedCount value={counts.total} style={styles.heroValue} />
          <Text style={styles.heroLabel}>applications</Text>
        </View>

        <View style={styles.rate}>
          <Text style={styles.rateValue}>{responseRate}%</Text>
          <Text style={styles.rateLabel}>moved forward</Text>
        </View>
      </View>

      <View style={styles.bar}>
        {STAGES.map((stage) => (
          <Segment key={stage} stage={stage} value={counts[stage]} total={counts.total} />
        ))}
      </View>

      <View style={styles.legend}>
        {STAGES.map((stage, index) => (
          <Animated.View
            key={stage}
            entering={FadeInDown.duration(280).delay(index * STAGGER_MS)}
            style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: STATUS_COLOR[stage] }]} />
            <View style={styles.legendText}>
              <AnimatedCount value={counts[stage]} style={styles.legendValue} />
              <Text style={styles.legendLabel} numberOfLines={1}>
                {STATUS_LABEL[stage]}
              </Text>
            </View>
          </Animated.View>
        ))}
      </View>
    </View>
  );
}

interface SegmentProps {
  stage: ApplicationStatus;
  value: number;
  total: number;
}

/**
 * One slice of the bar. Width animates via flex rather than a percentage string so the
 * whole thing stays on the UI thread, and an empty stage collapses to nothing instead
 * of holding a sliver of colour that implies a count it doesn't have.
 */
function Segment({ stage, value, total }: SegmentProps) {
  const styles = useStyles();
  const share = total > 0 ? value / total : 0;

  const flex = useDerivedValue(() => withTiming(share, { duration: GROW_MS }), [share]);

  const animatedStyle = useAnimatedStyle(() => ({
    flex: flex.value,
    // A zero-width mark still paints its 2px gap, which reads as a hairline of colour
    // in an otherwise empty stage. Dropping the margin closes it completely.
    marginRight: flex.value > 0 ? SEGMENT_GAP : 0,
  }));

  if (value === 0) return null;

  return (
    <Animated.View
      accessibilityRole="text"
      accessibilityLabel={`${STATUS_LABEL[stage]}: ${value} of ${total}`}
      style={[styles.segment, { backgroundColor: STATUS_COLOR[stage] }, animatedStyle]}
    />
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    gap: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  headline: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  hero: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  heroValue: {
    fontSize: fontSize.hero,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -1,
  },
  heroLabel: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
  },
  rate: {
    alignItems: 'flex-end',
  },
  rateValue: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.4,
  },
  rateLabel: {
    fontSize: fontSize.caption,
    color: colors.textTertiary,
  },
  bar: {
    flexDirection: 'row',
    height: BAR_HEIGHT,
    borderRadius: radius.pill,
    // The track shows through wherever a stage is empty, so a thin pile still reads as
    // a bar rather than a few floating chips.
    backgroundColor: colors.backgroundMuted,
    overflow: 'hidden',
  },
  segment: {
    height: '100%',
    borderRadius: radius.pill,
  },
  legend: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  legendItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  swatch: {
    width: 3,
    alignSelf: 'stretch',
    minHeight: 30,
    borderRadius: 2,
  },
  legendText: {
    flex: 1,
    gap: 1,
  },
  legendValue: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.4,
  },
  legendLabel: {
    fontSize: fontSize.caption,
    color: colors.textTertiary,
    fontWeight: '600',
  },
}));
