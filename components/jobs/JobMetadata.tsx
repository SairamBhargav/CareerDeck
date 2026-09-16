import { StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, spacing } from '@/constants/theme';
import type { Job } from '@/types';
import { formatLocationLine, formatSalary } from '@/utils/format';

interface JobMetadataProps {
  job: Job;
  onDark?: boolean;
  /** Reels emphasises salary; the Home list keeps everything the same weight. */
  emphasizeSalary?: boolean;
}

export function JobMetadata({ job, onDark = false, emphasizeSalary = false }: JobMetadataProps) {
  const salary = formatSalary(job);
  const locationLine = formatLocationLine(job);

  return (
    <View style={styles.container}>
      {salary ? (
        <Text
          style={[
            emphasizeSalary ? styles.salaryStrong : styles.line,
            onDark ? styles.textDark : styles.textLight,
          ]}>
          {salary}
        </Text>
      ) : null}
      <Text style={[styles.line, onDark ? styles.textMutedDark : styles.textMutedLight]}>
        {locationLine}
      </Text>
      <Text style={[styles.line, onDark ? styles.textMutedDark : styles.textMutedLight]}>
        {job.employmentType}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs / 2,
  },
  line: {
    fontSize: fontSize.body,
    fontWeight: '500',
  },
  salaryStrong: {
    fontSize: fontSize.title,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  textLight: { color: colors.text },
  textDark: { color: colors.reelText },
  textMutedLight: { color: colors.textSecondary },
  textMutedDark: { color: colors.reelTextSecondary },
});
