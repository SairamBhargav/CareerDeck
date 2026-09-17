import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/common/EmptyState';
import { colors, fontSize, screenPadding, spacing } from '@/constants/theme';

/**
 * Placeholder for the Activity tab — likes, saves, and application status updates land
 * here in a later milestone. Intentionally empty besides the shell.
 */
export default function ActivityScreen() {
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <Text style={styles.heading} accessibilityRole="header">
        Activity
      </Text>

      <View style={styles.body}>
        <EmptyState
          icon="notifications-outline"
          title="Nothing here yet"
          message="Likes, saves, and application updates will show up here."
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  heading: {
    fontSize: fontSize.heading,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.4,
    paddingHorizontal: screenPadding,
    paddingTop: spacing.sm,
  },
  body: {
    flex: 1,
    justifyContent: 'center',
  },
});
