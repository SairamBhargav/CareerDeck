import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, radius } from '@/constants/theme';

interface HomeHeaderProps {
  firstName: string;
  initials: string;
  onProfilePress: () => void;
}

export function HomeHeader({ firstName, initials, onProfilePress }: HomeHeaderProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.greeting}>Hey {firstName}</Text>

      <Pressable
        onPress={onProfilePress}
        accessibilityRole="button"
        accessibilityLabel="Open your profile"
        style={({ pressed }) => [styles.avatar, pressed ? styles.pressed : null]}>
        <Text style={styles.avatarText}>{initials}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  greeting: {
    fontSize: 34,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.8,
    lineHeight: 40,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: colors.accentText,
    fontWeight: '700',
    fontSize: fontSize.small,
  },
  pressed: {
    opacity: 0.7,
  },
});
