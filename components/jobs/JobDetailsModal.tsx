import { useEffect } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CompanyLogo } from '@/components/common/CompanyLogo';
import { IconButton } from '@/components/common/IconButton';
import { PrimaryButton } from '@/components/common/PrimaryButton';
import { SkillChip } from '@/components/common/SkillChip';
import { JobMetadata } from '@/components/jobs/JobMetadata';
import { fontSize, radius, screenPadding, spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';
import type { Job } from '@/types';
import { formatPostedAt } from '@/utils/format';

interface JobDetailsModalProps {
  job: Job | null;
  logoColor?: string;
  /** Company's real logo image, when available — falls back to job.companyLogo's monogram. */
  logoUrl?: string;
  visible: boolean;
  onClose: () => void;
  /** Auto Apply: the drafted-answers flow. */
  onAutoApply: () => void;
  /** Plain apply: open the employer's page and track it, no draft and no credit spent. */
  onApply: () => void;
}

/** Same thresholds as CommentSheet, so every sheet in the app lets go at the same point. */
const DISMISS_DISTANCE = 96;
const DISMISS_VELOCITY = 700;

/**
 * Full-height sheet opened from a reel's "More" action — every field the compact card
 * truncates or omits (full description, every requirement, every skill), plus a way to
 * jump straight into applying without going back to the reel first.
 */
export function JobDetailsModal({
  job,
  logoColor,
  logoUrl,
  visible,
  onClose,
  onAutoApply,
  onApply,
}: JobDetailsModalProps) {
  const insets = useSafeAreaInsets();
  const styles = useStyles();
  const translateY = useSharedValue(0);

  // A sheet dragged part-way and let go closes from wherever it was; the next one opens flat.
  useEffect(() => {
    if (visible) translateY.set(0);
  }, [visible, translateY]);

  /*
   * The top bar is the handle: drag it down to close, or tap it. Only the bar, not the body —
   * the body is a long ScrollView, and a pan over it would fight the scroll for every drag.
   */
  const pan = Gesture.Pan()
    .activeOffsetY(8)
    .failOffsetY(-8)
    .onUpdate((event) => {
      'worklet';
      translateY.set(Math.max(0, event.translationY));
    })
    .onEnd((event) => {
      'worklet';
      if (translateY.value > DISMISS_DISTANCE || event.velocityY > DISMISS_VELOCITY) {
        runOnJS(onClose)();
      } else {
        translateY.set(withTiming(0, { duration: 200 }));
      }
    });
  const tap = Gesture.Tap().onEnd(() => {
    'worklet';
    runOnJS(onClose)();
  });
  const handle = Gesture.Exclusive(pan, tap);

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  if (!job) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      {/* Its own root: a Modal is a separate native window, and on Android gestures inside one
          are only seen by a root mounted inside it. */}
      <GestureHandlerRootView style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close job details" />

        <Animated.View style={[styles.sheet, { paddingTop: insets.top }, sheetStyle]}>
          {/* The close button sits fully inside the bar. It used to hang below a 28pt bar, and
              the half outside its parent never received touches. */}
          <GestureDetector gesture={handle}>
            <View style={styles.topBar} accessibilityHint="Drag down or tap to close">
              <View style={styles.grabber} />
              <IconButton
                name="close"
                accessibilityLabel="Close job details"
                onPress={onClose}
                surface
                style={styles.closeButton}
              />
            </View>
          </GestureDetector>

          <ScrollView
            contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
            showsVerticalScrollIndicator={false}>
            <View style={styles.companyRow}>
              <CompanyLogo logo={logoUrl ?? job.companyLogo} name={job.companyName} color={logoColor} size="lg" />
              <View style={styles.companyText}>
                <Text style={styles.company} numberOfLines={1}>
                  {job.companyName}
                </Text>
                <Text style={styles.posted}>Posted {formatPostedAt(job.postedAt)}</Text>
              </View>
            </View>

            <Text style={styles.title}>{job.title}</Text>
            <JobMetadata job={job} emphasizeSalary />

            <Text style={styles.sectionTitle}>About the role</Text>
            <Text style={styles.body}>{job.description}</Text>

            <Text style={styles.sectionTitle}>What they look for</Text>
            {job.requirements.map((requirement) => (
              <View key={requirement} style={styles.bulletRow}>
                <Text style={styles.bullet}>{'\u2022'}</Text>
                <Text style={styles.body}>{requirement}</Text>
              </View>
            ))}

            <Text style={styles.sectionTitle}>Skills</Text>
            <View style={styles.skills}>
              {job.skills.map((skill) => (
                <SkillChip key={skill} label={skill} />
              ))}
            </View>

            <View style={styles.applyRow}>
              <PrimaryButton
                label="Apply"
                variant="secondary"
                onPress={onApply}
                accessibilityHint="Opens the employer's application page"
                style={styles.applyButton}
              />
              <PrimaryButton
                label="Auto Apply"
                onPress={onAutoApply}
                accessibilityHint="Drafts your answers, then opens the application with them filled in"
                style={styles.applyButton}
              />
            </View>
          </ScrollView>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  root: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  topBar: {
    height: 56,
    justifyContent: 'center',
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
  },
  closeButton: {
    position: 'absolute',
    right: screenPadding,
    top: 6,
  },
  content: {
    paddingHorizontal: screenPadding,
    paddingTop: spacing.xs,
    gap: spacing.sm,
  },
  companyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  companyText: {
    flex: 1,
  },
  company: {
    fontSize: fontSize.title,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  posted: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    marginTop: 2,
  },
  title: {
    fontSize: fontSize.display,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.7,
    marginTop: spacing.md,
  },
  sectionTitle: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.text,
    marginTop: spacing.lg,
  },
  body: {
    flex: 1,
    fontSize: fontSize.body,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  bulletRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  bullet: {
    fontSize: fontSize.body,
    lineHeight: 22,
    color: colors.textTertiary,
  },
  skills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  applyRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  applyButton: {
    flex: 1,
  },
}));
