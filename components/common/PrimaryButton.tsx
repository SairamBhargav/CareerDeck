import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';

import { colors, fontSize, minTapTarget, radius, spacing } from '@/constants/theme';

type ButtonVariant = 'primary' | 'secondary' | 'ghost';

interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  accessibilityHint?: string;
  style?: ViewStyle;
}

export function PrimaryButton({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  accessibilityHint,
  style,
}: PrimaryButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        VARIANT_STYLES[variant],
        pressed && !isDisabled ? styles.pressed : null,
        isDisabled ? styles.disabled : null,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.accentText : colors.text} />
      ) : (
        <Text style={[styles.label, VARIANT_LABEL_STYLES[variant]]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: minTapTarget,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  pressed: {
    opacity: 0.75,
  },
  disabled: {
    opacity: 0.45,
  },
  label: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
});

const VARIANT_STYLES = StyleSheet.create({
  primary: {
    backgroundColor: colors.accent,
  },
  secondary: {
    backgroundColor: colors.backgroundMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
});

const VARIANT_LABEL_STYLES = StyleSheet.create({
  primary: { color: colors.accentText },
  secondary: { color: colors.text },
  ghost: { color: colors.textSecondary },
});
