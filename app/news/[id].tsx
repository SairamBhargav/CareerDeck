import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';

import { CompanyLogo } from '@/components/common/CompanyLogo';
import { EmptyState } from '@/components/common/EmptyState';
import { PrimaryButton } from '@/components/common/PrimaryButton';
import { fontSize, radius, screenPadding, spacing } from '@/constants/theme';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useNewsById } from '@/hooks/useNewsFeed';
import { formatPostedAt } from '@/utils/format';

export default function NewsDetailScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { companies, isFollowing, toggleFollow } = useCareerDeck();
  const news = useNewsById(id);

  if (!news) {
    return (
      <View style={styles.missing}>
        <EmptyState
          icon="alert-circle-outline"
          title="Article not found"
          message="This story is no longer part of the current feed."
        />
      </View>
    );
  }

  const company = news.companyId ? companies.find((c) => c.id === news.companyId) : undefined;
  const following = company ? isFollowing(company.id) : false;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.badgeRow}>
        {company ? (
          <CompanyLogo logo={company.logo} name={company.name} color={company.logoColor} size="lg" />
        ) : (
          <View style={styles.industryBadge}>
            <Ionicons name="trending-up" size={26} color={colors.textInverse} />
          </View>
        )}

        <View style={styles.badgeText}>
          <Text style={styles.tag}>{news.tag}</Text>
          <Text style={styles.meta}>{formatPostedAt(news.publishedAt)}</Text>
        </View>
      </View>

      <Text style={styles.headline}>{news.headline}</Text>

      {news.body.map((paragraph, index) => (
        <Text key={index} style={styles.paragraph}>
          {paragraph}
        </Text>
      ))}

      {company ? (
        <View style={styles.actions}>
          <PrimaryButton
            label={following ? 'Following' : `Follow ${company.name}`}
            variant={following ? 'secondary' : 'primary'}
            onPress={() => toggleFollow(company.id)}
          />
        </View>
      ) : null}
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  missing: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  content: {
    padding: screenPadding,
    paddingBottom: spacing.xxl,
    gap: spacing.md,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  industryBadge: {
    width: 60,
    height: 60,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.text,
  },
  badgeText: {
    gap: 2,
  },
  tag: {
    fontSize: fontSize.small,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.textSecondary,
  },
  meta: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
  },
  headline: {
    fontSize: fontSize.display,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.6,
    lineHeight: 36,
    marginTop: spacing.md,
  },
  paragraph: {
    fontSize: fontSize.body,
    lineHeight: 23,
    color: colors.textSecondary,
  },
  actions: {
    marginTop: spacing.xl,
  },
}));
