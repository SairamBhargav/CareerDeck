import { useEffect, type RefObject } from 'react';
import { Platform, Pressable, StyleSheet, TextInput } from 'react-native';
import Animated, {
  Easing,
  ZoomIn,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';

interface CodeBoxesProps {
  length: number;
  value: string;
  onChangeText: (value: string) => void;
  inputRef: RefObject<TextInput | null>;
  editable: boolean;
  /** All digits in and being checked: the boxes turn green, one after another. */
  verifying: boolean;
}

/**
 * A one-time code as a row of boxes, one per digit.
 *
 * There is still exactly one TextInput, laid invisibly over the row. That keeps
 * everything the platform does for a code field: the iOS "From Messages" suggestion,
 * Android's SMS autofill, paste, and the number pad. The boxes only draw what it holds.
 */
export function CodeBoxes({ length, value, onChangeText, inputRef, editable, verifying }: CodeBoxesProps) {
  const styles = useStyles();
  const { colors } = useTheme();

  return (
    <Pressable onPress={() => inputRef.current?.focus()} accessible={false} style={styles.row}>
      {Array.from({ length }, (_, index) => (
        <Box
          key={index}
          index={index}
          digit={value[index] ?? ''}
          current={editable && !verifying && index === Math.min(value.length, length - 1) && value.length < length}
          verifying={verifying}
        />
      ))}

      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={(next) => onChangeText(next.replace(/\D/g, '').slice(0, length))}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={length}
        editable={editable}
        caretHidden
        selectionColor="transparent"
        cursorColor={colors.text}
        style={styles.hiddenInput}
        accessibilityLabel="Six-digit sign-up code"
      />
    </Pressable>
  );
}

function Box({ index, digit, current, verifying }: { index: number; digit: string; current: boolean; verifying: boolean }) {
  const styles = useStyles();
  const reduceMotion = useReducedMotion();

  const caret = useSharedValue(1);
  useEffect(() => {
    if (!current || reduceMotion) {
      caret.set(1);
      return;
    }
    caret.set(withRepeat(withSequence(withTiming(1, { duration: 500 }), withTiming(0, { duration: 500 })), -1));
    // Writing the shared value is the effect's whole job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, reduceMotion]);
  const caretStyle = useAnimatedStyle(() => ({ opacity: caret.value }));

  // The green runs left to right, so a correct code reads as being checked off.
  const bounce = useSharedValue(1);
  useEffect(() => {
    if (!verifying || reduceMotion) return;
    const pop = withSequence(
      withTiming(1.06, { duration: 140, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: 180, easing: Easing.inOut(Easing.quad) }),
    );
    bounce.set(withDelay(index * 60, pop));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verifying, reduceMotion]);
  const boxStyle = useAnimatedStyle(() => ({ transform: [{ scale: bounce.value }] }));

  return (
    <Animated.View
      style={[
        styles.box,
        digit ? styles.boxFilled : null,
        current ? styles.boxCurrent : null,
        verifying ? styles.boxDone : null,
        boxStyle,
      ]}>
      {digit ? (
        <Animated.Text
          key={digit}
          entering={reduceMotion ? undefined : ZoomIn.duration(160)}
          style={[styles.digit, verifying ? styles.digitDone : null]}>
          {digit}
        </Animated.Text>
      ) : current ? (
        <Animated.View style={[styles.caret, caretStyle]} />
      ) : null}
    </Animated.View>
  );
}

const useStyles = makeStyles((colors) => ({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  box: {
    flex: 1,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md + 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.backgroundMuted,
  },
  boxFilled: {
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
  },
  boxCurrent: {
    borderWidth: 1.5,
    borderColor: colors.text,
    backgroundColor: colors.surface,
  },
  boxDone: {
    borderWidth: 1.5,
    borderColor: colors.goalMet,
    backgroundColor: colors.goalMetSurface,
  },
  digit: {
    fontSize: fontSize.heading + 4,
    fontWeight: '700',
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  digitDone: {
    color: colors.goalMet,
  },
  caret: {
    width: 2,
    height: 26,
    borderRadius: 1,
    backgroundColor: colors.text,
  },
  // Covers the row so a tap anywhere lands in the field, and stays invisible. Not
  // display:none or zero-sized: iOS will not offer the one-time-code suggestion for a
  // field it considers hidden.
  hiddenInput: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: Platform.OS === 'ios' ? 0.02 : 0,
    color: 'transparent',
    fontSize: 1,
  },
}));
