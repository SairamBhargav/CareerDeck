import Ionicons from '@expo/vector-icons/Ionicons';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IconButton } from '@/components/common/IconButton';
import { SectionHeader } from '@/components/common/SectionHeader';
import { colors, fontSize, radius, screenPadding, spacing } from '@/constants/theme';
import { useCareerDeck } from '@/context/CareerDeckContext';

export default function ProfileScreen() {
  const { user, followedCompanyIds, savedJobIds, likedJobIds } = useCareerDeck();

  const rows = [
    { icon: 'document-text-outline', label: 'Resume', value: user.resumeName },
    { icon: 'options-outline', label: 'Preferences', value: `${user.preferredRoles.length} roles` },
    { icon: 'briefcase-outline', label: 'Applications', value: String(user.appliedCount) },
    { icon: 'business-outline', label: 'Following companies', value: String(followedCompanyIds.length) },
    { icon: 'bookmark-outline', label: 'Saved jobs', value: String(savedJobIds.length) },
    { icon: 'heart-outline', label: 'Liked jobs', value: String(likedJobIds.length) },
  ] as const;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.topBar}>
          <Text style={styles.heading} accessibilityRole="header">
            Profile
          </Text>
          <IconButton
            name="settings-outline"
            accessibilityLabel="Settings"
            onPress={() => {}}
            surface
          />
        </View>

        <View style={styles.identity}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {user.firstName.charAt(0)}
              {user.lastName.charAt(0)}
            </Text>
          </View>
          <Text style={styles.name}>{user.displayName}</Text>
          <Text style={styles.detail}>{user.school}</Text>
          <Text style={styles.detail}>
            {user.major} {'·'} Class of {user.graduationYear}
          </Text>
          <Text style={styles.detail}>{user.location}</Text>
        </View>

        <View style={styles.section}>
          <SectionHeader title="Your career" />
          <View style={styles.rows}>
            {rows.map((row, index) => (
              <View key={row.label} style={[styles.row, index > 0 ? styles.rowDivided : null]}>
                <Ionicons name={row.icon} size={18} color={colors.textSecondary} />
                <Text style={styles.rowLabel}>{row.label}</Text>
                <Text style={styles.rowValue} numberOfLines={1}>
                  {row.value}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <Text style={styles.footnote}>
          Editing, applications history, and saved collections arrive in a later milestone.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: screenPadding,
    paddingBottom: spacing.xxl,
    gap: spacing.xl,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
  },
  heading: {
    fontSize: fontSize.heading,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.4,
  },
  identity: {
    alignItems: 'center',
    gap: 2,
  },
  avatar: {
    width: 76,
    height: 76,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  avatarText: {
    color: colors.accentText,
    fontSize: fontSize.heading,
    fontWeight: '700',
  },
  name: {
    fontSize: fontSize.heading,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.4,
    marginBottom: spacing.xs,
  },
  detail: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
  },
  section: {
    gap: 0,
  },
  rows: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.lg,
  },
  rowDivided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  rowLabel: {
    flex: 1,
    fontSize: fontSize.body,
    color: colors.text,
    fontWeight: '500',
  },
  rowValue: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    maxWidth: '45%',
  },
  footnote: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    textAlign: 'center',
    lineHeight: 19,
  },
});
