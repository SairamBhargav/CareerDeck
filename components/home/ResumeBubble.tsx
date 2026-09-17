import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, radius, shadow, spacing } from '@/constants/theme';
import type { Resume } from '@/types';
import { formatPostedAt } from '@/utils/format';

export const RESUME_BUBBLE_WIDTH = 128;
const PREVIEW_HEIGHT = 150;

interface ResumeBubbleProps {
  resume: Resume;
  isDefault: boolean;
  onPress: () => void;
}

/**
 * A resume rendered as a real page-1 thumbnail — Google Drive–style, readable at a
 * glance without opening it. Tapping opens the actual PDF in ResumeViewerModal; the
 * checkmark badge is a pure status indicator for "this is the default," not something
 * you tap here to change.
 */
export function ResumeBubble({ resume, isDefault, onPress }: ResumeBubbleProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${resume.name}${isDefault ? ', default resume' : ''}`}
      style={({ pressed }) => [
        styles.card,
        isDefault ? styles.cardSelected : null,
        pressed ? styles.pressed : null,
      ]}>
      <View style={styles.preview}>
        <Image source={resume.thumbnail} style={styles.previewImage} resizeMode="cover" />

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
  },
  previewImage: {
    width: '100%',
    height: '100%',
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
