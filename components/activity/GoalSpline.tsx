import { useEffect, useMemo, useState } from 'react';
import { Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { Circle, Line, Path, Svg } from 'react-native-svg';

import { spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import type { GoalWeek } from '@/hooks/useWeeklyGoal';

const AnimatedPath = Animated.createAnimatedComponent(Path);

const CHART_HEIGHT = 72;
/** Room inside the panel so the end dots and the line's stroke never clip. */
const PAD_X = 8;
const PAD_Y = 8;
const DRAW_MS = 800;

interface GoalSplineProps {
  /** Oldest first, ending with the current week. */
  weeks: GoalWeek[];
  target: number;
  /** This week's goal is met: the last dot turns goal-green. */
  met: boolean;
}

interface Point {
  x: number;
  y: number;
}

/**
 * Applications per week as a smooth line, with the weekly goal as a dashed line across it.
 *
 * Ported from Amicro's Mono Rounded Spline Line (MIT,
 * github.com/Subhan-code/Amicro--Micro-transitions-), redrawn with react-native-svg and
 * Reanimated since the original is recharts on the web. Its grey dashed reference line is the
 * goal here, so a week above the dash is a week that cleared it.
 */
export function GoalSpline({ weeks, target, met }: GoalSplineProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);

  const draw = useSharedValue(reduced ? 1 : 0);
  const dots = useSharedValue(reduced ? 1 : 0);

  const chart = useMemo(() => {
    if (width <= 0 || weeks.length < 2) return null;

    // Headroom over whichever is higher, the best week or the goal, so neither sits on the edge.
    const top = Math.max(target, ...weeks.map((week) => week.count), 1) * 1.15;
    const innerW = width - PAD_X * 2;
    const innerH = CHART_HEIGHT - PAD_Y * 2;
    const yOf = (value: number) => PAD_Y + innerH * (1 - value / top);

    const points = weeks.map((week, index) => ({
      x: PAD_X + (innerW * index) / (weeks.length - 1),
      y: yOf(week.count),
    }));

    return {
      points,
      path: monotonePath(points),
      length: approximateLength(points),
      goalY: yOf(target),
      grid: [0.25, 0.5, 0.75].map((share) => PAD_Y + innerH * share),
    };
  }, [width, weeks, target]);

  // Draws once the panel has a width, and again if the weeks change underneath it.
  const pathKey = chart?.path;
  useEffect(() => {
    if (reduced || !pathKey) return;
    draw.set(0);
    dots.set(0);
    draw.set(withTiming(1, { duration: DRAW_MS, easing: Easing.bezier(0.16, 1, 0.3, 1) }));
    dots.set(withDelay(DRAW_MS * 0.6, withTiming(1, { duration: 260 })));
  }, [reduced, pathKey, draw, dots]);

  const length = chart?.length ?? 0;
  const lineProps = useAnimatedProps(() => ({
    strokeDashoffset: length * (1 - draw.get()),
  }));
  const dotsStyle = useAnimatedStyle(() => ({ opacity: dots.get() }));

  const handleLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);
  const last = weeks.length - 1;

  return (
    <View style={styles.wrap} accessibilityRole="summary" accessibilityLabel={describe(weeks, target)}>
      <View style={styles.panel} onLayout={handleLayout}>
        {chart ? (
          <Svg width={width} height={CHART_HEIGHT}>
            {chart.grid.map((y) => (
              <Line
                key={y}
                x1={PAD_X}
                x2={width - PAD_X}
                y1={y}
                y2={y}
                stroke={colors.border}
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            ))}

            <Line
              x1={PAD_X}
              x2={width - PAD_X}
              y1={chart.goalY}
              y2={chart.goalY}
              stroke={colors.textTertiary}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              strokeLinecap="round"
            />

            <AnimatedPath
              d={chart.path}
              fill="none"
              stroke={colors.textSecondary}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={`${chart.length} ${chart.length}`}
              animatedProps={lineProps}
            />
          </Svg>
        ) : null}

        {/* Dots as an overlay, so they fade in as one layer after the line arrives. */}
        {chart ? (
          <Animated.View style={[styles.dots, dotsStyle]} pointerEvents="none">
            <Svg width={width} height={CHART_HEIGHT}>
              {chart.points.map((point, index) => (
                <Circle
                  key={weeks[index]?.key ?? index}
                  cx={point.x}
                  cy={point.y}
                  r={index === last ? 4 : 2.75}
                  fill={index === last ? (met ? colors.goalMet : colors.text) : colors.textSecondary}
                  stroke={colors.backgroundMuted}
                  strokeWidth={2}
                />
              ))}
            </Svg>
          </Animated.View>
        ) : null}
      </View>

      <View style={styles.axis}>
        <Text style={styles.axisLabel}>{weeks[0]?.label}</Text>
        <Text style={styles.axisGoal}>Goal {target}/wk</Text>
        <Text style={[styles.axisLabel, styles.axisNow]}>This week</Text>
      </View>
    </View>
  );
}

/**
 * A monotone cubic through the points (Fritsch–Carlson, what recharts' `type="monotone"` uses).
 * Unlike a plain spline it never overshoots: a week of zero stays on the floor instead of the
 * curve dipping below it.
 */
function monotonePath(points: Point[]): string {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const n = points.length;
  const x = (i: number) => xs[i] ?? 0;
  const y = (i: number) => ys[i] ?? 0;
  if (n === 0) return '';
  if (n === 1) return `M${x(0)},${y(0)}`;

  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const step = x(i + 1) - x(i);
    dx.push(step);
    slope.push((y(i + 1) - y(i)) / step);
  }
  const d = (i: number) => dx[i] ?? 0;
  const m = (i: number) => slope[i] ?? 0;

  const tangent: number[] = [m(0)];
  for (let i = 1; i < n - 1; i += 1) {
    if (m(i - 1) * m(i) <= 0) {
      tangent.push(0);
    } else {
      const common = d(i - 1) + d(i);
      tangent.push((3 * common) / ((common + d(i)) / m(i - 1) + (common + d(i - 1)) / m(i)));
    }
  }
  tangent.push(m(n - 2));
  const t = (i: number) => tangent[i] ?? 0;

  let path = `M${x(0)},${y(0)}`;
  for (let i = 0; i < n - 1; i += 1) {
    const third = d(i) / 3;
    path += ` C${x(i) + third},${y(i) + t(i) * third} ${x(i + 1) - third},${y(i + 1) - t(i + 1) * third} ${x(i + 1)},${y(i + 1)}`;
  }
  return path;
}

/** Chord length with a margin for the curves, comfortably at least the true path length. */
function approximateLength(points: Point[]): number {
  let total = 0;
  points.forEach((point, i) => {
    const previous = points[i - 1];
    if (previous) total += Math.hypot(point.x - previous.x, point.y - previous.y);
  });
  return Math.ceil(total * 1.2);
}

function describe(weeks: GoalWeek[], target: number): string {
  return `Applications per week against a goal of ${target}: ${weeks
    .map((week) => `${week.label}, ${week.count}`)
    .join('; ')}`;
}

const useStyles = makeStyles((colors) => ({
  wrap: {
    gap: spacing.xs + 2,
  },
  panel: {
    height: CHART_HEIGHT,
    borderRadius: 14,
    backgroundColor: colors.backgroundMuted,
    overflow: 'hidden',
  },
  dots: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  axis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  axisLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textTertiary,
  },
  axisNow: {
    color: colors.text,
  },
  axisGoal: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textTertiary,
  },
}));
