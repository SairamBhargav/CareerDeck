import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, Text, View } from 'react-native';

import { fontSize, radius, screenPadding, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';

interface RelevantHintProps {
  /** True when the ranker knows neither the reader's field nor their stage. */
  knowsNothing: boolean;
  /** True when it knows the stage but not the field. */
  missingField: boolean;
  onPress: () => void;
}

/**
 * Relevant is only as good as what the deck knows. When it knows nothing, or only the stage,
 * say so and say how to fix it — rather than showing a feed that looks personalized and isn't.
 */
export function RelevantHint({ knowsNothing, missingField, onPress }: RelevantHintProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  if (!knowsNothing && !missingField) return null;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}>
      <Ionicons name="sparkles-outline" size={18} color={colors.text} />
      <View style={styles.text}>
        <Text style={styles.title}>
          {knowsNothing ? 'Make this feed yours' : 'Add your major'}
        </Text>
        <Text style={styles.body}>
          Add your major and a resume, and Relevant ranks roles for what you study and the skills you have.
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    marginHorizontal: screenPadding,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundMuted,
  },
  pressed: {
    opacity: 0.8,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.text,
  },
  body: {
    fontSize: fontSize.caption,
    lineHeight: 16,
    color: colors.textSecondary,
  },
}));
