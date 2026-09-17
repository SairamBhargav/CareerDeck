import { Text, View } from 'react-native';

import { fontSize, spacing } from '@/constants/theme';
import { makeStyles } from '@/context/ThemeContext';
import type { Job } from '@/types';
import { formatLocationLine, formatSalary } from '@/utils/format';

interface JobMetadataProps {
  job: Job;
  /** Reels emphasises salary; the Home list keeps everything the same weight. */
  emphasizeSalary?: boolean;
}

export function JobMetadata({ job, emphasizeSalary = false }: JobMetadataProps) {
  const styles = useStyles();
  const salary = formatSalary(job);
  const locationLine = formatLocationLine(job);

  return (
    <View style={styles.container}>
      {salary ? (
        <Text style={emphasizeSalary ? styles.salaryStrong : styles.line}>{salary}</Text>
      ) : null}
      <Text style={styles.lineMuted}>{locationLine}</Text>
      <Text style={styles.lineMuted}>{job.employmentType}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: {
    gap: spacing.xs / 2,
  },
  line: {
    fontSize: fontSize.body,
    fontWeight: '500',
    color: colors.text,
  },
  lineMuted: {
    fontSize: fontSize.body,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  salaryStrong: {
    fontSize: fontSize.title,
    fontWeight: '700',
    letterSpacing: -0.2,
    color: colors.text,
  },
}));
