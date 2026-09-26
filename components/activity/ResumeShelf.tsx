import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';

import { SectionHeader } from '@/components/common/SectionHeader';
import { Skeleton } from '@/components/common/Skeleton';
import { RESUME_BUBBLE_WIDTH, ResumeBubble } from '@/components/activity/ResumeBubble';
import { FREE_RESUME_LIMIT } from '@/constants/limits';
import { fontSize, radius, screenPadding, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useResumePreviewUrls } from '@/hooks/useResumes';
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

  /*
   * The limit is the database's (`register_resume` raises CD011 past it); this is only so the
   * tile can say so first. A user who has filled the shelf should see that, not discover it
   * after picking a file.
   */
  const full = resumes.length >= FREE_RESUME_LIMIT;
  const addDisabled = busy || full;

  /*
   * Signed URLs for the page previews. Shares the viewer's cache, so warming these also makes
   * tapping a resume open instantly instead of on a spinner — see `useResumePreviewUrls`.
   * Skipped entirely while the shelf is still loading, so a skeleton does not sign anything.
   */
  const previewUrls = useResumePreviewUrls(resumes, !loading);

  return (
    <View>
      <View style={styles.header}>
        <SectionHeader title="Your Resumes" />
        {/*
          Shown only once there is something to count, so a first-run shelf is not an
          announcement about a limit the user has nowhere near reached.
        */}
        {resumes.length > 0 ? (
          <Text style={[styles.count, full ? styles.countFull : null]}>
            {resumes.length} of {FREE_RESUME_LIMIT}
          </Text>
        ) : null}
      </View>

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
              previewUri={previewUrls.get(item.id)}
              onPress={() => onView(item.id)}
            />
          )}
          ListFooterComponent={
            <Pressable
              onPress={addDisabled ? undefined : onAdd}
              disabled={addDisabled}
              accessibilityRole="button"
              accessibilityLabel={
                full ? 'Shelf full. Delete a resume to add another.' : 'Add a resume'
              }
              accessibilityState={{ disabled: addDisabled }}
              style={({ pressed }) => [
                styles.add,
                pressed ? styles.addPressed : null,
                addDisabled ? styles.addBusy : null,
              ]}>
              {busy ? (
                <ActivityIndicator color={colors.textTertiary} />
              ) : (
                <Ionicons
                  name={full ? 'lock-closed-outline' : 'add'}
                  size={full ? 22 : 28}
                  color={colors.textSecondary}
                />
              )}
              <Text style={styles.addLabel}>
                {busy ? 'Working…' : full ? 'Shelf full' : 'Add resume'}
              </Text>
              {/*
                The way out, on the tile itself. "Shelf full" on its own is a dead end; the
                next action is deleting one, and this is where the user is looking.
              */}
              {full && !busy ? <Text style={styles.addHint}>Delete one to add another</Text> : null}
            </Pressable>
          }
        />
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  /*
   * SectionHeader carries its own bottom margin, so the row pulls the count up onto the
   * same baseline rather than adding a second line of vertical rhythm.
   */
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  count: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.textTertiary,
    paddingTop: 2,
  },
  countFull: {
    color: colors.textSecondary,
  },
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
  addHint: {
    fontSize: fontSize.caption,
    color: colors.textTertiary,
    textAlign: 'center',
    paddingHorizontal: spacing.sm,
    lineHeight: 14,
  },
}));
