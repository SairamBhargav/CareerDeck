import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

/**
 * Exact on-screen positions for the first-run tour's highlights.
 *
 * The tour points at controls that live deep inside the app's own components — the heart on
 * the Deck's rail, a sort chip, the follow mark beside a company name. Computing where those
 * sit from layout constants put the rings near the controls rather than on them, so the
 * components mark their controls with `<TourAnchor id>` instead, and each reports its own
 * window rect.
 *
 * Outside the tour there is no provider and `TourAnchor` renders its child as-is: no wrapper
 * view, no measuring, nothing in the app's layout changes.
 */

export interface AnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TourAnchorValue {
  report: (id: string, rect: AnchorRect) => void;
  /** Bumped by the tour whenever a step changes, so every anchor measures again. */
  epoch: number;
}

const TourAnchorContext = createContext<TourAnchorValue | null>(null);

export function TourAnchorProvider({
  report,
  epoch,
  children,
}: TourAnchorValue & { children: ReactNode }) {
  return <TourAnchorContext.Provider value={{ report, epoch }}>{children}</TourAnchorContext.Provider>;
}

interface TourAnchorProps {
  id: string;
  /**
   * Omitted for a marker: `style={StyleSheet.absoluteFill}` inside the target's own box,
   * where wrapping the target would mean re-nesting a long block.
   */
  children?: ReactNode;
  /** The wrapper's style inside the tour, for a child whose parent lays it out (`flex: 1`). */
  style?: StyleProp<ViewStyle>;
}

export function TourAnchor({ id, children, style }: TourAnchorProps) {
  const tour = useContext(TourAnchorContext);
  if (!tour) return children ? <>{children}</> : null;
  return (
    <MeasuredAnchor id={id} tour={tour} style={style}>
      {children}
    </MeasuredAnchor>
  );
}

/** How long after a step change to measure again: once things settle, and once after any entrance. */
const REMEASURE_MS = [60, 450];

function MeasuredAnchor({
  id,
  tour,
  style,
  children,
}: TourAnchorProps & { tour: TourAnchorValue }) {
  const [node, setNode] = useState<View | null>(null);
  const { report, epoch } = tour;

  const measure = useCallback(() => {
    node?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) report(id, { x, y, width, height });
    });
  }, [node, report, id]);

  useEffect(() => {
    const timers = REMEASURE_MS.map((ms) => setTimeout(measure, ms));
    return () => timers.forEach(clearTimeout);
  }, [measure, epoch]);

  return (
    <View
      ref={setNode}
      collapsable={false}
      onLayout={measure}
      // A marker never takes the touch meant for the control it sits inside.
      pointerEvents={children ? 'auto' : 'none'}
      style={style}>
      {children}
    </View>
  );
}
