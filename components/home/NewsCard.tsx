import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CompanyLogo } from '@/components/common/CompanyLogo';
import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import type { NewsItem } from '@/types';
import { formatPostedAt } from '@/utils/format';

export const NEWS_CARD_HEIGHT = 232;

interface NewsCardProps {
  item: NewsItem;
  width: number;
  /** Brand color for the company badge, looked up by the carousel so this stays a dumb component. */
  companyColor?: string;
  onPress: () => void;
}

export function NewsCard({ item, width, companyColor, onPress }: NewsCardProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const isCompanyNews = item.category === 'company';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.tag}: ${item.headline}`}
      style={({ pressed }) => [styles.card, { width }, pressed ? styles.pressed : null]}>
      {/* The accent block stands in for artwork, so it keeps its full brand colour in
          both schemes rather than being dimmed down with the rest of the surface. */}
      <View style={[styles.visual, { backgroundColor: item.accentColor }]}>
        {isCompanyNews && item.companyLogo && item.companyName ? (
          <CompanyLogo logo={item.companyLogo} name={item.companyName} color={companyColor} size="lg" />
        ) : (
          <View style={styles.industryBadge}>
            <Ionicons name="trending-up" size={26} color={colors.textInverse} />
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.tag} numberOfLines={1}>
          {item.tag}
        </Text>
        <Text style={styles.headline} numberOfLines={2}>
          {item.headline}
        </Text>
        <Text style={styles.subtext} numberOfLines={2}>
          {item.subtext}
        </Text>
        <Text style={styles.meta}>{formatPostedAt(item.publishedAt)}</Text>
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    height: NEWS_CARD_HEIGHT,
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  pressed: {
    opacity: 0.85,
  },
  visual: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  industryBadge: {
    width: 60,
    height: 60,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.text,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: 2,
    backgroundColor: colors.surface,
  },
  tag: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.textTertiary,
  },
  headline: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.text,
    lineHeight: 19,
    marginTop: 2,
  },
  subtext: {
    fontSize: fontSize.caption + 1,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  meta: {
    fontSize: fontSize.caption,
    color: colors.textTertiary,
    marginTop: 2,
  },
}));
