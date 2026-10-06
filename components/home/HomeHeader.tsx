import { Pressable, Text, View } from 'react-native';

import { UserAvatar } from '@/components/common/UserAvatar';
import { fontSize } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';

interface HomeHeaderProps {
  firstName: string;
  /** The reader's pseudonym — their avatar is the same creature other people see beside their comments. */
  handle: string | null;
  onProfilePress: () => void;
}

export function HomeHeader({ firstName, handle, onProfilePress }: HomeHeaderProps) {
  const styles = useStyles();

  return (
    <View style={styles.row}>
      <Text style={styles.greeting}>Hey {firstName}</Text>

      <Pressable
        onPress={onProfilePress}
        accessibilityRole="button"
        accessibilityLabel="Open your profile"
        style={({ pressed }) => (pressed ? styles.pressed : null)}>
        <UserAvatar handle={handle} size={44} />
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
  pressed: {
    opacity: 0.7,
  },
}));
