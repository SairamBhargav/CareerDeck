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
      <View>
        <Text style={styles.brand}>CareerDeck</Text>
        <Text style={styles.greeting}>Hey, {firstName}</Text>
      </View>

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
  brand: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: colors.textTertiary,
  },
  greeting: {
    fontSize: fontSize.heading,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.4,
    marginTop: 2,
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
