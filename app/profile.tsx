import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IconButton } from '@/components/common/IconButton';
import { RowGroup, type RowGroupItem } from '@/components/common/RowGroup';
import { SectionHeader } from '@/components/common/SectionHeader';
import { SkillChip } from '@/components/common/SkillChip';
import { EditProfileSheet } from '@/components/profile/EditProfileSheet';
import { PreferencesSheet } from '@/components/profile/PreferencesSheet';
import { ProfileHeader } from '@/components/profile/ProfileHeader';
import { fontSize, screenPadding, spacing } from '@/constants/theme';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { makeStyles } from '@/context/ThemeContext';
import { useWeeklyGoal } from '@/hooks/useWeeklyGoal';

/** How many preference chips the Profile row previews before it stops counting them out. */
const PREVIEW_CHIPS = 3;

/**
 * Reached from the avatar button on Home — not a tab. There's no dedicated Profile
 * slot in the bottom bar; this screen is pushed on top of it instead.
 *
 * Identity, how the season is going, and what the user is looking for live here.
 * Preferences and account live on Settings, reached via the gear — see app/settings.tsx.
 */
export default function ProfileScreen() {
  const router = useRouter();
  const styles = useStyles();
  const {
    user,
    resumes,
    defaultResume,
    applications,
    followedCompanyIds,
    savedJobIds,
    likedJobIds,
    preferredRoles,
    preferredLocations,
    autoApplyCredits,
    setPreferredRoles,
    setPreferredLocations,
    updateIdentity,
  } = useCareerDeck();

  const goal = useWeeklyGoal();

  const [editingProfile, setEditingProfile] = useState(false);
  const [editingPreferences, setEditingPreferences] = useState(false);

  // The root layout holds the splash until the profile has loaded and shows an error
  // screen if it can't, so this screen is never reached without one. Narrowing the type
  // rather than defaulting it — there is no sensible stand-in for "who you are".
  if (!user) return null;

  const previewRoles = preferredRoles.slice(0, PREVIEW_CHIPS);
  const extraRoles = preferredRoles.length - previewRoles.length;

  const lookingRows: RowGroupItem[] = [
    {
      key: 'preferences',
      icon: 'options-outline',
      label: 'Roles and locations',
      hint:
        preferredRoles.length > 0 || preferredLocations.length > 0
          ? `${preferredRoles.length} ${preferredRoles.length === 1 ? 'role' : 'roles'} · ${preferredLocations.length} ${preferredLocations.length === 1 ? 'location' : 'locations'}`
          : 'Nothing set yet',
      onPress: () => setEditingPreferences(true),
    },
    {
      key: 'resumes',
      icon: 'document-text-outline',
      label: 'Resumes',
      // Which one the apply sheet will reach for. The resumes themselves live on
      // Activity, so this is a read-only figure rather than a way in.
      hint: defaultResume ? `Default · ${defaultResume.focus}` : 'No default set',
      value: `${resumes.length} saved`,
    },
  ];

  const collectionRows: RowGroupItem[] = [
    {
      key: 'applications',
      icon: 'briefcase-outline',
      label: 'Applications',
      // Counted off the tracker rather than a seeded figure, so this can't drift away
      // from what Activity shows.
      hint: `${goal.count} this week`,
      onPress: () => router.push('/(tabs)/activity'),
    },
    {
      key: 'following',
      icon: 'business-outline',
      label: 'Following companies',
      hint: countLabel(followedCompanyIds.length, 'company', 'companies'),
      onPress: () => router.push({ pathname: '/collection/[type]', params: { type: 'following' } }),
    },
    {
      key: 'saved',
      icon: 'bookmark-outline',
      label: 'Saved jobs',
      hint: countLabel(savedJobIds.length, 'posting', 'postings'),
      onPress: () => router.push({ pathname: '/collection/[type]', params: { type: 'saved' } }),
    },
    {
      key: 'liked',
      icon: 'heart-outline',
      label: 'Liked jobs',
      hint: countLabel(likedJobIds.length, 'posting', 'postings'),
      onPress: () => router.push({ pathname: '/collection/[type]', params: { type: 'liked' } }),
    },
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

        <ProfileHeader
          user={user}
          streakWeeks={goal.streakWeeks}
          applications={applications.length}
          autoApplyCredits={autoApplyCredits}
          onEdit={() => setEditingProfile(true)}
        />

        <Animated.View entering={FadeInDown.duration(300).delay(150)}>
          <SectionHeader title="Looking for" actionLabel="Edit" onActionPress={() => setEditingPreferences(true)} />

          {previewRoles.length > 0 ? (
            <View style={styles.chips}>
              {previewRoles.map((role) => (
                <SkillChip key={role} label={role} />
              ))}
              {extraRoles > 0 ? <SkillChip label={`+${extraRoles} more`} /> : null}
            </View>
          ) : null}

          <RowGroup items={lookingRows} />
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(300).delay(210)}>
          <SectionHeader title="Your collections" />
          <RowGroup items={collectionRows} />
        </Animated.View>
      </ScrollView>

      {editingPreferences ? (
        <PreferencesSheet
          roles={preferredRoles}
          locations={preferredLocations}
          onSave={(roles, locations) => {
            setPreferredRoles(roles);
            setPreferredLocations(locations);
            setEditingPreferences(false);
          }}
          onClose={() => setEditingPreferences(false)}
        />
      ) : null}

      {editingProfile ? (
        <EditProfileSheet
          user={user}
          onSave={(edit) => {
            updateIdentity(edit);
            setEditingProfile(false);
          }}
          onClose={() => setEditingProfile(false)}
        />
      ) : null}
    </SafeAreaView>
  );
}

/** "3 postings", "1 company" — a figure that reads as a sentence rather than a tally. */
function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
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
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
}));
