import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { SkillChip } from '@/components/common/SkillChip';
import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import type { Job } from '@/types';
import { parseJobSections } from '@/utils/jobSections';

interface JobSectionsViewProps {
  job: Job;
}

/**
 * A posting's body in the same shape for every job: About the role, What you'll do, What you
 * need, Nice to have, Skills — each only when the posting has it — and the employer's full text
 * behind a toggle at the end. Shared by the reel's details sheet and the job screen, so the two
 * can never drift into different layouts again. Sections come from utils/jobSections.ts.
 */
export function JobSectionsView({ job }: JobSectionsViewProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const sections = useMemo(() => parseJobSections(job.description, job), [job]);
  const [showFull, setShowFull] = useState(false);

  if (sections.isStub) {
    return (
      <View style={styles.root}>
        <Text style={styles.sectionTitle}>About the role</Text>
        <View style={styles.notice}>
          <Ionicons name="open-outline" size={18} color={colors.textSecondary} />
          <Text style={styles.noticeText}>
            {job.companyName} only publishes the full description on its own site. Tap Apply to read it there.
          </Text>
        </View>
        {sections.facts.map((fact) => (
          <Text key={fact.label} style={styles.body}>
            <Text style={styles.factLabel}>{fact.label}: </Text>
            {fact.value}
          </Text>
        ))}
        <Skills skills={job.skills} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Text style={styles.sectionTitle}>About the role</Text>
      {sections.overview.map((paragraph) => (
        <Text key={paragraph} style={styles.body}>
          {paragraph}
        </Text>
      ))}

      <BulletSection title="What you'll do" items={sections.responsibilities} />
      <BulletSection title="What you need" items={sections.requirements} />
      <BulletSection title="Nice to have" items={sections.preferred} />
      <Skills skills={job.skills} />

      <Pressable
        onPress={() => setShowFull((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded: showFull }}
        hitSlop={8}
        style={({ pressed }) => [styles.toggle, pressed ? styles.pressed : null]}>
        <Text style={styles.toggleLabel}>{showFull ? 'Hide full posting' : 'Read the full posting'}</Text>
        <Ionicons name={showFull ? 'chevron-up' : 'chevron-down'} size={14} color={colors.text} />
      </Pressable>
      {showFull ? <Text style={styles.fullText}>{job.description}</Text> : null}
    </View>
  );
}

function BulletSection({ title, items }: { title: string; items: string[] }) {
  const styles = useStyles();
  if (items.length === 0) return null;
  return (
    <>
      <Text style={styles.sectionTitle}>{title}</Text>
      {items.map((item) => (
        <View key={item} style={styles.bulletRow}>
          <Text style={styles.bullet}>{'•'}</Text>
          <Text style={styles.body}>{item}</Text>
        </View>
      ))}
    </>
  );
}

function Skills({ skills }: { skills: string[] }) {
  const styles = useStyles();
  if (skills.length === 0) return null;
  return (
    <>
      <Text style={styles.sectionTitle}>Skills</Text>
      <View style={styles.skills}>
        {skills.map((skill) => (
          <SkillChip key={skill} label={skill} />
        ))}
      </View>
    </>
  );
}

const useStyles = makeStyles((colors) => ({
  root: {
    gap: spacing.sm,
  },
  sectionTitle: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.text,
    marginTop: spacing.lg,
  },
  body: {
    flex: 1,
    fontSize: fontSize.body,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  bulletRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  bullet: {
    fontSize: fontSize.body,
    lineHeight: 22,
    color: colors.textTertiary,
  },
  skills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  notice: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.backgroundMuted,
  },
  noticeText: {
    flex: 1,
    fontSize: fontSize.body,
    lineHeight: 22,
    color: colors.textSecondary,
  },
  factLabel: {
    fontWeight: '700',
    color: colors.text,
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    marginTop: spacing.xl,
  },
  pressed: {
    opacity: 0.7,
  },
  toggleLabel: {
    fontSize: fontSize.body,
    fontWeight: '700',
    color: colors.text,
  },
  fullText: {
    fontSize: fontSize.small,
    lineHeight: 20,
    color: colors.textSecondary,
  },
}));
