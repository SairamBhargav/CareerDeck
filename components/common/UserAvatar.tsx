import { Blobatar } from '@blobatar/react-native';
import { View } from 'react-native';

import { makeStyles } from '@/context/ThemeContext';

interface UserAvatarProps {
  /**
   * The person's generated pseudonym (`profiles.handle`). Never a real name or an email: the
   * seed is what decides the picture, and README §3.8 keeps people anonymous to each other, so
   * the avatar is derived from the one identifier everybody can already see.
   */
  handle: string | null | undefined;
  size: number;
}

/**
 * A little creature per person — blobatar.dev, MIT, drawn locally with react-native-svg, no
 * network. The same pseudonym is the same creature everywhere it appears (comments,
 * notifications, Home, Profile), which is what makes a semi-anonymous thread readable: you can
 * tell two people apart without knowing who either of them is.
 *
 * The still `Blobatar`, not the idle-animated one: these sit in scrolling lists.
 */
export function UserAvatar({ handle, size }: UserAvatarProps) {
  const styles = useStyles();
  return (
    <View
      style={[styles.plate, { width: size, height: size, borderRadius: size / 2 }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      {/* A handle can be missing for a moment while a profile loads; a fixed seed keeps a shape there. */}
      <Blobatar name={handle || 'careerdeck'} size={size * 0.86} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  // The blob has a transparent backdrop; a soft plate keeps it legible on any background.
  plate: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: colors.backgroundMuted,
  },
}));
