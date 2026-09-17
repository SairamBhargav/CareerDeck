import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/common/EmptyState';
import { StatRow, type Stat } from '@/components/home/StatRow';
import { colors, fontSize, screenPadding, spacing } from '@/constants/theme';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { useHideTabBarOnScroll } from '@/hooks/useHideTabBarOnScroll';
import { useTabBarHeight } from '@/hooks/useTabBarHeight';

/**
 * Following / Applied / Queued live here rather than on Home, since they're a record of
 * what the user has done rather than something to discover. Likes, saves, and application
 * status get their own dedicated views in a later milestone.
 */
export default function ActivityScreen() {
  const { user, companies, followedCompanyIds, savedJobIds } = useCareerDeck();
  const [showFollowingList, setShowFollowingList] = useState(false);
  const tabBarHeight = useTabBarHeight();
  const scrollHandler = useHideTabBarOnScroll(tabBarHeight);

  const followedCompanies = companies.filter((company) => followedCompanyIds.includes(company.id));

  const stats: Stat[] = [
    {
      label: 'Following',
      value: followedCompanyIds.length,
      onPress: () => setShowFollowingList((current) => !current),
    },
    { label: 'Applied', value: user.appliedCount },
    { label: 'Queued', value: savedJobIds.length },
  ];

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <Animated.ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: spacing.xxl + tabBarHeight }]}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}>
        <Text style={styles.heading} accessibilityRole="header">
          Activity
        </Text>

        <StatRow stats={stats} />

        {showFollowingList ? (
          <View style={styles.followingListCard}>
            {followedCompanies.length > 0 ? (
              followedCompanies.map((company) => (
                <Text key={company.id} style={styles.followingCompany}>
                  • {company.name}
                </Text>
              ))
            ) : (
              <Text style={styles.emptyState}>You’re not following any companies yet.</Text>
            )}
          </View>
        ) : null}

        <View style={styles.body}>
          <EmptyState
            icon="notifications-outline"
            title="More coming soon"
            message="Saved jobs, likes, and application status will get their own view here."
          />
        </View>
      </Animated.ScrollView>
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
    gap: spacing.md,
  },
  heading: {
    fontSize: fontSize.heading,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.4,
    paddingTop: spacing.sm,
  },
  followingListCard: {
    backgroundColor: colors.backgroundMuted,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 4,
  },
  followingCompany: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  emptyState: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  body: {
    paddingTop: spacing.xl,
  },
});
