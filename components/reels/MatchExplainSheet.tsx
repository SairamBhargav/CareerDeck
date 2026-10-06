import Ionicons from '@expo/vector-icons/Ionicons';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fontSize, radius, screenPadding, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import type { Job, MatchScore } from '@/types';

interface MatchExplainSheetProps {
  job: Job | null;
  match: MatchScore | null;
  visible: boolean;
  onClose: () => void;
}

const FAMILY_LABELS: Record<string, string> = {
  software: 'Software',
  data_ml: 'Data & ML',
  hardware: 'Hardware',
  product: 'Product',
  design: 'Design',
  business: 'Business & finance',
  sales_marketing: 'Sales & marketing',
  operations: 'Operations',
};

const LEVEL_LABELS: Record<string, string> = {
  intern: 'Internship',
  new_grad: 'New grad',
  mid: 'Mid-level',
  senior: 'Senior',
  staff_plus: 'Staff+',
};

/**
 * Why the ring says what it says: which of the posting's skills the resume has and which it is
 * missing, whether the job is in the reader's field, and whether it is at their level. The number
 * is only worth trusting if it can be taken apart, and this is the place that takes it apart.
 * Everything here comes from `job_match_scores.components` (scorer v2).
 */
export function MatchExplainSheet({ job, match, visible, onClose }: MatchExplainSheetProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  if (!job || !match) return null;
  const { components } = match;
  const listed = components.matched.length + components.missing.length;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close match details" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.grabber} />
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Text style={styles.score}>{match.score}%</Text>
          <Text style={styles.subtitle} numberOfLines={2}>
            match between your resume and {job.title} at {job.companyName}
          </Text>

          <Text style={styles.sectionTitle}>Skills</Text>
          {components.limited || listed === 0 ? (
            <Text style={styles.body}>
              This posting doesn&apos;t list specific skills, so this score is an estimate from the field and level.
            </Text>
          ) : (
            <>
              <Text style={styles.body}>
                You have {components.matched.length} of the {listed} skills this job lists.
              </Text>
              <View style={styles.chips}>
                {components.matched.map((skill) => (
                  <View key={`have-${skill}`} style={[styles.chip, styles.chipHave]}>
                    <Ionicons name="checkmark" size={13} color={colors.text} />
                    <Text style={styles.chipLabel}>{skill}</Text>
                  </View>
                ))}
                {components.missing.map((skill) => (
                  <View key={`miss-${skill}`} style={[styles.chip, styles.chipMissing]}>
                    <Text style={styles.chipLabelMuted}>{skill}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {typeof components.field === 'number' ? (
            <Row
              title="Field"
              value={FAMILY_LABELS[components.jobFamily ?? ''] ?? 'This role'}
              verdict={fieldVerdict(components.field)}
              good={components.field >= 0.5}
            />
          ) : null}

          {typeof components.seniority === 'number' ? (
            <Row
              title="Level"
              value={LEVEL_LABELS[job.seniority ?? ''] ?? 'Unlisted'}
              verdict={levelVerdict(components.seniority)}
              good={components.seniority >= 0.6}
            />
          ) : null}

          {typeof components.location === 'number' ? (
            <Row
              title="Location"
              value={job.locationType === 'Remote' ? 'Remote' : job.location}
              verdict={components.location >= 1 ? 'Somewhere you said works' : 'Not one of your locations'}
              good={components.location >= 1}
            />
          ) : null}

          <Text style={styles.footnote}>
            Compares your default resume with what the posting asks for. Your degree decides the field.
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

function Row({ title, value, verdict, good }: { title: string; value: string; verdict: string; good: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <Ionicons
        name={good ? 'checkmark-circle' : 'remove-circle-outline'}
        size={20}
        color={good ? colors.text : colors.textTertiary}
      />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>
          {title} · {value}
        </Text>
        <Text style={styles.body}>{verdict}</Text>
      </View>
    </View>
  );
}

function fieldVerdict(field: number): string {
  if (field >= 0.99) return 'In your field';
  if (field >= 0.5) return 'Close to your field';
  if (field >= 0.3) return 'Next to your field — some overlap';
  return 'Outside your field';
}

function levelVerdict(seniority: number): string {
  if (seniority >= 0.99) return 'Right level for you';
  if (seniority >= 0.6) return 'One step from your level';
  return 'Well above or below your level';
}

const useStyles = makeStyles((colors) => ({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    maxHeight: '80%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.sm,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
    marginBottom: spacing.md,
  },
  content: {
    paddingHorizontal: screenPadding,
    gap: spacing.sm,
  },
  score: {
    fontSize: fontSize.display,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.6,
  },
  subtitle: {
    fontSize: fontSize.body,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  sectionTitle: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.text,
    marginTop: spacing.lg,
  },
  body: {
    fontSize: fontSize.body,
    lineHeight: 21,
    color: colors.textSecondary,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  chipHave: {
    backgroundColor: colors.backgroundMuted,
    borderColor: colors.backgroundMuted,
  },
  chipMissing: {
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  chipLabel: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.text,
  },
  chipLabelMuted: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.text,
  },
  footnote: {
    marginTop: spacing.xl,
    fontSize: fontSize.small,
    lineHeight: 18,
    color: colors.textTertiary,
  },
}));
