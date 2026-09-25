import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';

import { SectionHeader } from '@/components/common/SectionHeader';
import { Skeleton } from '@/components/common/Skeleton';
import { RESUME_BUBBLE_WIDTH, ResumeBubble } from '@/components/activity/ResumeBubble';
import { fontSize, radius, screenPadding, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import type { Resume } from '@/types';

const SKELETON_COUNT = 3;
const BUBBLE_HEIGHT = 208;

interface ResumeShelfProps {
  resumes: Resume[];
  loading: boolean;
  onView: (resumeId: string) => void;
  /**
   * Opens the file picker. Phase 4's actual entry point — through phase 3 there was no way to
   * add a resume at all, because the two that existed were compiled into the app.
   */
  onAdd: () => void;
  /** True while an upload or a parse is in flight, so the tile can say so. */
  busy: boolean;
}

/**
 * The stored resumes as a row of page-1 thumbnails, at the top of Activity — they're
 * part of the record of what the user has built, which is what this tab is for, rather
 * than something to scroll past on the way to a feed.
 *
 * Activity pads its whole scroll view, so the list breaks back out to the screen edge
 * itself: a carousel that stops short of the edge reads as clipped rather than as
 * having more to the right.
 */
export function ResumeShelf({ resumes, loading, onView, onAdd, busy }: ResumeShelfProps) {
  const styles = useStyles();
  const { colors } = useTheme();

  return (
    <View>
      <SectionHeader title="Your Resumes" />

      {loading ? (
        <View style={styles.skeletonRow}>
          {Array.from({ length: SKELETON_COUNT }, (_, index) => (
            <Skeleton
              key={index}
              width={RESUME_BUBBLE_WIDTH}
              height={BUBBLE_HEIGHT}
              borderRadius={radius.xl}
            />
          ))}
        </View>
      ) : (
        <FlatList
          horizontal
          data={resumes}
          keyExtractor={(resume) => resume.id}
          showsHorizontalScrollIndicator={false}
          style={styles.bleed}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <ResumeBubble
              resume={item}
              /*
               * Read off the row rather than compared against an id held in a component above.
               * `defaultResumeId` used to be a `useState` in `CareerDeckContext`; "exactly one
               * default" is now a partial unique index, so the row itself is the answer. §3.9.
               */
              isDefault={item.isDefault}
              onPress={() => onView(item.id)}
            />
          )}
          ListFooterComponent={
            <Pressable
              onPress={busy ? undefined : onAdd}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Add a resume"
              style={({ pressed }) => [
                styles.add,
                pressed ? styles.addPressed : null,
                busy ? styles.addBusy : null,
              ]}>
              {busy ? (
                <ActivityIndicator color={colors.textTertiary} />
              ) : (
                <Ionicons name="add" size={28} color={colors.textSecondary} />
              )}
              <Text style={styles.addLabel}>{busy ? 'Working…' : 'Add resume'}</Text>
            </Pressable>
          }
        />
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  // Cancels Activity's screen padding so bubbles can run off both edges, then the
  // content inset below puts the first one back in line with the heading.
  bleed: {
    marginHorizontal: -screenPadding,
  },
  list: {
    paddingHorizontal: screenPadding,
    gap: spacing.md,
  },
  skeletonRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  /*
   * Dashed rather than solid, and the same footprint as a bubble. It reads as a slot waiting
   * to be filled instead of as a sixth document, which matters on a shelf whose whole job is
   * to show what is already there.
   */
  add: {
    width: RESUME_BUBBLE_WIDTH,
    height: BUBBLE_HEIGHT,
    borderRadius: radius.xl,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  addPressed: {
    opacity: 0.6,
  },
  addBusy: {
    opacity: 0.5,
  },
  addLabel: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    color: colors.textSecondary,
  },
}));
