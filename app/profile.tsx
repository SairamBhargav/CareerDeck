import { useRouter } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IconButton } from '@/components/common/IconButton';
import { RowGroup, type RowGroupItem } from '@/components/common/RowGroup';
import { SectionHeader } from '@/components/common/SectionHeader';
import { fontSize, radius, screenPadding, spacing } from '@/constants/theme';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { makeStyles } from '@/context/ThemeContext';

/**
 * Reached from the avatar button on Home — not a tab. There's no dedicated Profile
 * slot in the bottom bar; this screen is pushed on top of it instead.
 *
 * Identity and career stats live here; preferences and account live on Settings,
 * reached via the gear icon — see app/settings.tsx.
 */
export default function ProfileScreen() {
  const router = useRouter();
  const styles = useStyles();
  const { user, resumes, defaultResume, applications, followedCompanyIds, savedJobIds, likedJobIds } =
    useCareerDeck();

  const careerRows: RowGroupItem[] = [
    {
      key: 'resumes',
      icon: 'document-text-outline',
      label: 'Resumes',
      // Which one the apply sheet will reach for. The resumes themselves live on
      // Activity now, so this is a read-only figure rather than a way in.
      hint: defaultResume ? `Default · ${defaultResume.focus}` : 'No default set',
      value: `${resumes.length} saved`,
    },
    { key: 'preferences', icon: 'options-outline', label: 'Preferences', value: `${user.preferredRoles.length} roles` },
    // Counted off the tracker rather than the seeded figure on `user`, so this can't
    // drift away from what Activity shows.
    { key: 'applications', icon: 'briefcase-outline', label: 'Applications', value: String(applications.length) },
    {
      key: 'following',
      icon: 'business-outline',
      label: 'Following companies',
      value: String(followedCompanyIds.length),
    },
    { key: 'saved', icon: 'bookmark-outline', label: 'Saved jobs', value: String(savedJobIds.length) },
    { key: 'liked', icon: 'heart-outline', label: 'Liked jobs', value: String(likedJobIds.length) },
  ];

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.topBar}>
          <IconButton
            name="chevron-back"
            accessibilityLabel="Go back"
            onPress={() => router.back()}
            surface
          />
          <Text style={styles.heading} accessibilityRole="header">
            Profile
          </Text>
          <IconButton
            name="settings-outline"
            accessibilityLabel="Settings"
            onPress={() => router.push('/settings')}
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

        <View>
          <SectionHeader title="Your career" />
          <RowGroup items={careerRows} />
        </View>

        <Text style={styles.footnote}>
          Editing, applications history, and saved collections arrive in a later milestone.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
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
  footnote: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    textAlign: 'center',
    lineHeight: 19,
  },
}));
