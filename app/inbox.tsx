import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MyCommentCard } from '@/components/activity/MyCommentCard';
import { NotificationCard } from '@/components/activity/NotificationCard';
import { EmptyState } from '@/components/common/EmptyState';
import { IconButton } from '@/components/common/IconButton';
import { fontSize, radius, screenPadding, spacing } from '@/constants/theme';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { makeStyles } from '@/context/ThemeContext';
import { useMyComments } from '@/hooks/useComments';
import { useGuardedRouter } from '@/hooks/useGuardedRouter';
import { useJobsByIds } from '@/hooks/useJobFeeds';

/** Per-row stagger on a list's entrance, capped so a long list's tail isn't left waiting. */
const STAGGER_MS = 45;
const MAX_STAGGER_INDEX = 7;

type InboxView = 'updates' | 'comments';

/**
 * What used to be Activity's Comments tab, as its own screen with two ways in.
 *
 * The bell on Activity opens `updates`: replies to the reader's comments, deadline reminders,
 * anything the app sends. The Comments door opens `comments`: what the reader has posted, so
 * they can find a thread again. Both lists lived under one tab before, which put the thing
 * with a badge on it behind a tap the badge could not be seen from.
 */
export default function InboxScreen() {
  const router = useGuardedRouter();
  const styles = useStyles();
  const { show } = useLocalSearchParams<{ show?: string }>();
  const view: InboxView = show === 'comments' ? 'comments' : 'updates';

  const { notifications, markNotificationRead, markAllNotificationsRead } = useCareerDeck();
  const myComments = useMyComments(view === 'comments');

  const jobIds = useMemo(
    () => [...new Set(notifications.map((entry) => entry.jobId).filter((id): id is string => id !== null))],
    [notifications],
  );
  const { jobs } = useJobsByIds(view === 'updates' ? jobIds : []);
  const jobById = useMemo(() => new Map(jobs.map((job) => [job.id, job])), [jobs]);

  // The badge clears a beat after the list opens rather than on the tap, long enough that
  // the reader sees which rows were new. A no-op when nothing is unread.
  useEffect(() => {
    if (view !== 'updates') return;
    const timer = setTimeout(markAllNotificationsRead, 1200);
    return () => clearTimeout(timer);
  }, [view, notifications, markAllNotificationsRead]);

  // Straight into the thread: from a comment, the comments are what you came back for.
  const openThread = (jobId: string) =>
    router.push({ pathname: '/job/[id]', params: { id: jobId, comments: '1' } });

  const title = view === 'updates' ? 'Updates' : 'Your comments';

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.topBar}>
          <IconButton name="chevron-back" accessibilityLabel="Go back" onPress={() => router.back()} surface />
          <Text style={styles.heading} accessibilityRole="header">
            {title}
          </Text>
          <View style={styles.spacer} />
        </View>

        {view === 'updates' ? (
          notifications.length === 0 ? (
            <EmptyState
              icon="notifications-outline"
              title="Nothing new"
              message="Replies to your comments and reminders about postings you saved land here."
            />
          ) : (
            <View style={styles.list}>
              {notifications.map((entry, index) => {
                const job = entry.jobId === null ? undefined : jobById.get(entry.jobId);
                return (
                  <Animated.View
                    key={entry.id}
                    entering={FadeInDown.duration(260).delay(Math.min(index, MAX_STAGGER_INDEX) * STAGGER_MS)}>
                    <NotificationCard
                      entry={entry}
                      // A posting that has since closed and been swept is a real case, not an
                      // error: the notification still reads, it just cannot be opened.
                      jobTitle={job?.title ?? 'A posting'}
                      companyName={job?.companyName ?? ''}
                      onPress={() => {
                        markNotificationRead(entry.id);
                        if (entry.jobId !== null) openThread(entry.jobId);
                      }}
                    />
                  </Animated.View>
                );
              })}
            </View>
          )
        ) : myComments.comments.length === 0 ? (
          <EmptyState
            icon="chatbubbles-outline"
            title={myComments.isLoading ? 'Loading…' : 'No comments yet'}
            message="Ask about the interview, the team, the timeline. Your comments, and the replies they get, land here."
          />
        ) : (
          <View style={styles.list}>
            {myComments.comments.map((comment, index) => (
              <Animated.View
                key={comment.id}
                entering={FadeInDown.duration(260).delay(Math.min(index, MAX_STAGGER_INDEX) * STAGGER_MS)}>
                <MyCommentCard comment={comment} onPress={() => openThread(comment.jobId)} />
              </Animated.View>
            ))}
            {myComments.hasMore ? (
              <Pressable onPress={myComments.loadMore} accessibilityRole="button" style={styles.more}>
                <Text style={styles.moreText}>Show older comments</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: screenPadding,
    paddingBottom: spacing.xxl,
    gap: spacing.xl,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
  },
  heading: {
    fontSize: fontSize.heading,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.4,
  },
  spacer: {
    width: 44,
  },
  list: {
    gap: spacing.md,
  },
  more: {
    alignSelf: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
  },
  moreText: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.textSecondary,
  },
}));
