import { Pressable, Text, View } from 'react-native';

import { fontSize, radius } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';

interface HomeHeaderProps {
  firstName: string;
  initials: string;
  onProfilePress: () => void;
}

export function HomeHeader({ firstName, initials, onProfilePress }: HomeHeaderProps) {
  const styles = useStyles();

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

const useStyles = makeStyles((colors) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  greeting: {
    // One step down the scale from `hero`, which crowded the avatar beside it.
    fontSize: fontSize.display,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.7,
    lineHeight: 36,
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
}));
