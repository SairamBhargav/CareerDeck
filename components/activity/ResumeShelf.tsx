import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';

import { Skeleton } from '@/components/common/Skeleton';
import { RESUME_BUBBLE_WIDTH, ResumeBubble } from '@/components/activity/ResumeBubble';
import { fontSize, radius, screenPadding, spacing } from '@/constants/theme';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useResumePreviewUrls } from '@/hooks/useResumes';
import type { Resume } from '@/types';

const SKELETON_COUNT = 3;
/** A bubble's rendered height, so the skeletons and the add tile line up with real ones. */
const BUBBLE_HEIGHT = 214;

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
 * The stored resumes as a row of page-1 thumbnails, on Activity under the check-in — they're
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
  const { credits } = useCareerDeck();

  /*
   * The limit is the database's (`register_resume` raises CD011 past it); this is only so the
   * tile can say so first. A user who has filled the shelf should see that, not discover it
   * after picking a file. Phase 6 made it the plan's: `plans.resume_limit`, read with the
   * balance, so a subscriber's shelf grows the moment the webhook lands.
   */
  const limit = credits.resumeLimit;
  const full = resumes.length >= limit;
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
        <Text style={styles.title} accessibilityRole="header">
          Resumes
          {/*
            Shown only once there is something to count, so a first-run shelf is not an
            announcement about a limit the user has nowhere near reached.
          */}
          {resumes.length > 0 ? (
            <Text style={[styles.count, full ? styles.countFull : null]}>
              {'  '}
              {resumes.length} of {limit}
            </Text>
          ) : null}
        </Text>
        {/* What "default" is for, said once where the choice is made: the match scores on
            every card are read against that resume's profile. */}
        {resumes.length > 1 ? <Text style={styles.hint}>Default is used for matching</Text> : null}
      </View>

      {loading ? (
        <View style={styles.skeletonRow}>
          {Array.from({ length: SKELETON_COUNT }, (_, index) => (
            <Skeleton
              key={index}
              width={RESUME_BUBBLE_WIDTH}
              height={BUBBLE_HEIGHT}
              borderRadius={radius.xl - 4}
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
                <View style={[styles.addIcon, full ? styles.addIconFull : null]}>
                  <Ionicons
                    name={full ? 'lock-closed' : 'add'}
                    size={full ? 18 : 24}
                    color={full ? colors.textSecondary : colors.accentText}
                  />
                </View>
              )}
              <Text style={styles.addLabel}>
                {busy ? 'Working…' : full ? 'Shelf full' : 'Add a PDF'}
              </Text>
              {!full && !busy && resumes.length > 0 ? (
                <Text style={styles.addHint}>
                  {limit - resumes.length} {limit - resumes.length === 1 ? 'slot' : 'slots'} left
                </Text>
              ) : null}
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
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: fontSize.title,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.3,
  },
  count: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.textTertiary,
  },
  countFull: {
    color: colors.textSecondary,
  },
  hint: {
    flexShrink: 1,
    fontSize: fontSize.small,
    fontWeight: '600',
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
    borderRadius: radius.xl - 4,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  addIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addIconFull: {
    backgroundColor: colors.backgroundMuted,
  },
  addPressed: {
    opacity: 0.6,
  },
  addBusy: {
    opacity: 0.5,
  },
  addLabel: {
    fontSize: fontSize.small + 1,
    fontWeight: '800',
    color: colors.text,
  },
  addHint: {
    fontSize: fontSize.caption,
    color: colors.textTertiary,
    textAlign: 'center',
    paddingHorizontal: spacing.sm,
    lineHeight: 14,
  },
}));
