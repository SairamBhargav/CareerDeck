import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
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
 * One stored resume on the Activity shelf.
 *
 * ── What happened to the thumbnail ────────────────────────────────────────────
 *
 * Through phase 3 this rendered a real page-1 image, because the two resumes in the app were
 * bundled assets with a `.png` sitting next to the `.pdf`. A resume the user uploaded this
 * afternoon has no such image, and producing one means rendering a page of an arbitrary PDF —
 * a native dependency, on a file the user supplied, for a picture of a document they already
 * recognise by name.
 *
 * So the preview is a glyph and the *parse state* instead, which turns out to be the thing
 * worth showing: "we read this one" versus "we could not" is information the user needs and a
 * thumbnail never carried. The bucket for real thumbnails exists in the phase 4 migration for
 * whenever that render pipeline is worth building.
 */
export function ResumeBubble({ resume, isDefault, onPress }: ResumeBubbleProps) {
  const { colors } = useTheme();
  const styles = useStyles();

  const state = describe(resume);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${resume.name}${isDefault ? ', default resume' : ''}. ${state.label}.`}
      style={({ pressed }) => [
        styles.card,
        isDefault ? styles.cardSelected : null,
        pressed ? styles.pressed : null,
      ]}>
      <View style={styles.preview}>
        {resume.parseStatus === 'parsing' ? (
          <ActivityIndicator color={colors.textTertiary} />
        ) : (
          <Ionicons
            name={state.icon}
            size={44}
            color={state.tone === 'bad' ? colors.danger : colors.textTertiary}
          />
        )}

        <Text
          style={[styles.state, state.tone === 'bad' ? { color: colors.danger } : null]}
          numberOfLines={1}>
          {state.label}
        </Text>

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

/**
 * The four parse states, in the words the shelf uses.
 *
 * `parsed` deliberately reports the skill count rather than saying "Ready": the number is the
 * one piece of evidence that the parse actually worked, and a resume that came back with two
 * skills is visibly different from one that came back with thirty.
 */
function describe(resume: Resume): {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  tone: 'normal' | 'bad';
} {
  switch (resume.parseStatus) {
    case 'parsed': {
      const count = resume.profile.skills.length;
      return {
        icon: resume.profile.confirmedAt ? 'checkmark-circle-outline' : 'document-text-outline',
        label: count === 1 ? '1 skill' : `${count} skills`,
        tone: 'normal',
      };
    }
    case 'parsing':
      return { icon: 'document-text-outline', label: 'Reading…', tone: 'normal' };
    case 'failed':
      return { icon: 'alert-circle-outline', label: "Couldn't read", tone: 'bad' };
    default:
      return { icon: 'document-outline', label: 'Not read yet', tone: 'normal' };
  }
}

const useStyles = makeStyles((colors) => ({
  card: {
    width: RESUME_BUBBLE_WIDTH,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    overflow: 'hidden',
    ...colors.shadowSoft,
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
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  state: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    color: colors.textTertiary,
    paddingHorizontal: spacing.xs,
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
}));
