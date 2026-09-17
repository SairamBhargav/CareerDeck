import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, radius, shadow, spacing } from '@/constants/theme';
import type { Resume } from '@/types';
import { formatPostedAt } from '@/utils/format';

export const RESUME_BUBBLE_WIDTH = 128;
const PREVIEW_HEIGHT = 100;

interface ResumeBubbleProps {
  resume: Resume;
  isDefault: boolean;
  onPress: () => void;
}

/**
 * A resume rendered as a small "peek into the page" card — a Google Docs–style thumbnail
 * with a mock header bar and paragraph lines standing in for real content, since resume
 * upload/parsing doesn't exist yet. Tapping sets it as the default used on the apply sheet.
 */
export function ResumeBubble({ resume, isDefault, onPress }: ResumeBubbleProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${resume.name}, ${isDefault ? 'default resume' : 'tap to set as default'}`}
      style={({ pressed }) => [
        styles.card,
        isDefault ? styles.cardSelected : null,
        pressed ? styles.pressed : null,
      ]}>
      <View style={styles.preview}>
        <View style={styles.previewHeader} />
        {resume.previewLines.map((width, index) => (
          <View key={index} style={[styles.previewLine, { width: `${width * 100}%` }]} />
        ))}

        {isDefault ? (
          <View style={styles.badge}>
            <Ionicons name="checkmark" size={12} color={colors.accentText} />
          </View>
        ) : null}
      </View>

      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={2}>
          {resume.name}
        </Text>
        <Text style={styles.meta}>{formatPostedAt(resume.updatedAt)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: RESUME_BUBBLE_WIDTH,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadow.soft,
  },
  cardSelected: {
    borderColor: colors.text,
  },
  pressed: {
    opacity: 0.85,
  },
  preview: {
    height: PREVIEW_HEIGHT,
    backgroundColor: colors.backgroundMuted,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    gap: 5,
  },
  previewHeader: {
    width: '55%',
    height: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.borderStrong,
    marginBottom: 2,
  },
  previewLine: {
    height: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.border,
  },
  badge: {
    position: 'absolute',
    right: spacing.xs,
    bottom: spacing.xs,
    width: 20,
    height: 20,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
  },
  text: {
    padding: spacing.sm,
    gap: 1,
  },
  name: {
    fontSize: fontSize.caption + 1,
    fontWeight: '700',
    color: colors.text,
    lineHeight: 15,
  },
  meta: {
    fontSize: fontSize.caption,
    color: colors.textTertiary,
  },
});
