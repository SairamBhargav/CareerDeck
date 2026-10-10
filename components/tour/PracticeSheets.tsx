import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { usePaywallColors } from '@/components/paywall/palette';
import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';

/** A bottom sheet over a scrim, the shape every sheet in the app takes. */
function PracticeSheet({ children }: { children: ReactNode }) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <>
      <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} style={styles.scrim} />
      <Animated.View
        // A plain slide, like the app's own sheets; it used to spring up, which read as a pop.
        entering={SlideInDown.duration(260).easing(Easing.out(Easing.cubic))}
        exiting={SlideOutDown.duration(200)}
        style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.grabber} />
        {children}
      </Animated.View>
    </>
  );
}

export function PracticeAutoApply({ companyName, onDone }: { companyName: string; onDone: () => void }) {
  const styles = useStyles();
  const { scheme } = useTheme();
  const pro = usePaywallColors();
  const rows = [
    ['Resume', 'Your resume'],
    ['Short answers', '4 of 4 drafted'],
    ['Cover note', `Written for ${companyName}`],
  ];

  return (
    <PracticeSheet>
      <View style={styles.applyHead}>
        <Ionicons name="flash-outline" size={22} color={pro.violet} />
        <Text style={styles.applyTitle}>Your draft is ready</Text>
      </View>
      <Text style={styles.applyLead}>
        Auto Apply filled this in from your resume. You check it, then submit on {companyName}&apos;s site.
      </Text>
      <View style={styles.table}>
        {rows.map(([label, value], index) => (
          <View key={label} style={[styles.tableRow, index > 0 ? styles.tableRule : null]}>
            <Text style={styles.tableLabel}>{label}</Text>
            <Text style={styles.tableValue}>{value}</Text>
          </View>
        ))}
      </View>
      <View
        style={[
          styles.note,
          { backgroundColor: scheme === 'dark' ? 'rgba(167,139,255,0.16)' : '#F2EEFF' },
        ]}>
        <Text style={[styles.noteText, { color: scheme === 'dark' ? '#C9BBFF' : '#4A35B8' }]}>
          Practice run: nothing is sent, and no Auto Apply is used.
        </Text>
      </View>

      <Pressable
        onPress={onDone}
        accessibilityRole="button"
        style={({ pressed }) => [styles.gradientButton, pressed ? styles.pressed : null]}>
        <Svg style={StyleSheet.absoluteFill} preserveAspectRatio="none" viewBox="0 0 100 10">
          <Defs>
            <LinearGradient id="tourApply" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={pro.violet} />
              <Stop offset="1" stopColor={pro.magenta} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100" height="10" fill="url(#tourApply)" />
        </Svg>
        <Text style={[styles.primaryLabel, { color: '#FFFFFF' }]}>Looks good</Text>
      </Pressable>
    </PracticeSheet>
  );
}

const useStyles = makeStyles((colors) => ({
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: spacing.sm + 2,
    paddingHorizontal: spacing.xl - 4,
    gap: spacing.lg,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.background,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
  },
  applyHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
  },
  applyTitle: {
    fontSize: fontSize.title + 2,
    fontWeight: '700',
    letterSpacing: -0.3,
    color: colors.text,
  },
  applyLead: {
    fontSize: fontSize.body - 1,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  table: {
    borderRadius: radius.lg - 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tableRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.md + 2,
    paddingHorizontal: spacing.lg,
  },
  tableRule: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  tableLabel: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
  },
  tableValue: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.text,
  },
  note: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md + 2,
    borderRadius: radius.md,
  },
  noteText: {
    fontSize: fontSize.small,
    lineHeight: 18,
  },
  gradientButton: {
    height: 54,
    borderRadius: radius.lg - 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  primaryLabel: {
    fontSize: fontSize.body + 2,
    fontWeight: '700',
    color: colors.background,
  },
  pressed: {
    opacity: 0.8,
  },
}));
