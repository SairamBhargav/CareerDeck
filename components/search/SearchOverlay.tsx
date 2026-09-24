import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurView } from 'expo-blur';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/common/EmptyState';
import { JobFeedCard } from '@/components/home/JobFeedCard';
import { CompanyResultRow } from '@/components/search/CompanyResultRow';
import { SearchScopeTabs } from '@/components/search/SearchScopeTabs';
import { fontSize, radius, screenPadding, spacing } from '@/constants/theme';
import { useCareerDeck } from '@/context/CareerDeckContext';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { useListImpressions } from '@/hooks/useImpressions';
import { MIN_QUERY_LENGTH, useSearch, type SearchScope } from '@/hooks/useSearch';
import type { Company, Job } from '@/types';

/** How long the panel takes to rise into place, and the backdrop to reach full blur. */
const ENTER_MS = 220;
const EXIT_MS = 160;
/** Distance the panel travels on open — small enough to read as a lift, not a page push. */
const PANEL_RISE = 24;
const MAX_RECENTS = 6;
/** Per-result stagger on the entrance cascade, capped so late rows aren't left waiting. */
const STAGGER_MS = 28;
const MAX_STAGGER_INDEX = 8;

interface SearchOverlayProps {
  visible: boolean;
  onClose: () => void;
  onPressJob: (job: Job) => void;
  onPressCompany: (company: Company) => void;
}

/**
 * Full-screen search, opened from Home's SearchBar.
 *
 * It owns the field, the scope and the query — Home only knows whether it's open. The
 * backdrop is a blur over the page rather than an opaque screen, so search reads as a
 * layer on top of Home rather than a place you navigated to, which is what makes
 * dismissing it feel like closing something instead of going back.
 *
 * Recents live in component state and reset with the app, matching the rest of
 * Milestone 0's no-backend posture.
 */
export function SearchOverlay({ visible, onClose, onPressJob, onPressCompany }: SearchOverlayProps) {
  const { colors, scheme } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const inputRef = useRef<TextInput>(null);
  const { toggleFollow, toggleSave } = useCareerDeck();

  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<SearchScope>('jobs');
  const [recents, setRecents] = useState<string[]>([]);

  const results = useSearch(query);

  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(visible ? 1 : 0, { duration: visible ? ENTER_MS : EXIT_MS });
  }, [visible, progress]);

  // Autofocus on the Modal's own prop is unreliable on Android, where the window isn't
  // attached yet when the child mounts — focusing on the next frame is.
  useEffect(() => {
    if (!visible) return;
    const handle = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(handle);
  }, [visible]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const panelStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * PANEL_RISE }],
  }));

  /** Remembers the term behind a result the user actually opened, newest first, no duplicates. */
  const rememberQuery = useCallback((term: string) => {
    const trimmed = term.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) return;
    setRecents((current) => [trimmed, ...current.filter((entry) => entry !== trimmed)].slice(0, MAX_RECENTS));
  }, []);

  const handleClose = useCallback(() => {
    Keyboard.dismiss();
    setQuery('');
    onClose();
  }, [onClose]);

  const openJob = (job: Job) => {
    rememberQuery(query);
    handleClose();
    onPressJob(job);
  };

  const openCompany = (company: Company) => {
    rememberQuery(query);
    handleClose();
    onPressCompany(company);
  };

  const showingJobs = scope === 'jobs';
  /*
   * §3.6. Search impressions are the most legible signal in the system: the reader said
   * what they wanted, and these are the postings shown in answer. Gated on the jobs tab
   * — the same list renders companies under the other one — and reset per query, because
   * the same card returned for a different search is a different impression.
   */
  const impressions = useListImpressions('search', {
    enabled: showingJobs,
    resetKey: query.trim().toLowerCase(),
  });

  const activeResults = showingJobs ? results.jobs : results.companies;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={handleClose}>
      <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
        <BlurView intensity={Platform.OS === 'android' ? 40 : 28} tint={scheme} style={StyleSheet.absoluteFill} />
        {/* The blur alone doesn't separate the panel from a busy page — this carries the contrast. */}
        <View style={[StyleSheet.absoluteFill, styles.scrim]} />
      </Animated.View>

      <Animated.View style={[styles.panel, { paddingTop: insets.top + spacing.sm }, panelStyle]}>
        <View style={styles.searchRow}>
          <View style={styles.field}>
            <Ionicons name="search" size={18} color={colors.textTertiary} />
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={setQuery}
              placeholder="Search jobs and companies"
              placeholderTextColor={colors.textTertiary}
              returnKeyType="search"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
              onSubmitEditing={() => rememberQuery(query)}
            />
            {query.length > 0 ? (
              <Pressable
                onPress={() => setQuery('')}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
              </Pressable>
            ) : null}
          </View>

          <Pressable
            onPress={handleClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Close search"
            style={({ pressed }) => (pressed ? styles.pressed : undefined)}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
        </View>

        <View style={styles.tabs}>
          <SearchScopeTabs scope={scope} onChange={setScope} />
        </View>

        {!results.isActive ? (
          <RecentSearches
            recents={recents}
            onPick={(term) => {
              setQuery(term);
              inputRef.current?.focus();
            }}
            onClear={() => setRecents([])}
          />
        ) : activeResults.length === 0 ? (
          <EmptyState
            icon={showingJobs ? 'briefcase-outline' : 'business-outline'}
            title={`No ${showingJobs ? 'jobs' : 'companies'} found`}
            message={`Nothing matches "${query.trim()}". Try a different title, company, or skill.`}
          />
        ) : (
          <FlatList
            // Remounting per scope restarts the entrance cascade, so switching tabs
            // animates in rather than swapping the rows out underneath a static list.
            key={scope}
            data={activeResults as (Job | Company)[]}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[styles.results, { paddingBottom: insets.bottom + spacing.xxl }]}
            initialNumToRender={8}
            windowSize={7}
            viewabilityConfigCallbackPairs={impressions.viewabilityConfigCallbackPairs}
            renderItem={({ item, index }) => (
              <Animated.View entering={FadeInDown.duration(220).delay(Math.min(index, MAX_STAGGER_INDEX) * STAGGER_MS)}>
                {showingJobs ? (
                  <JobFeedCard
                    job={item as Job}
                    logoColor={(item as Job).companyLogoColor ?? undefined}
                    logoUrl={(item as Job).companyLogoUrl ?? undefined}
                    onPress={() => openJob(item as Job)}
                    onToggleSave={() => toggleSave(item.id)}
                  />
                ) : (
                  <CompanyResultRow
                    company={item as Company}
                    onPress={() => openCompany(item as Company)}
                    onToggleFollow={() => toggleFollow((item as Company).slug)}
                  />
                )}
              </Animated.View>
            )}
          />
        )}
      </Animated.View>
    </Modal>
  );
}

interface RecentSearchesProps {
  recents: string[];
  onPick: (term: string) => void;
  onClear: () => void;
}

/** What fills the panel before the query is long enough to search on. */
function RecentSearches({ recents, onPick, onClear }: RecentSearchesProps) {
  const { colors } = useTheme();
  const styles = useStyles();

  if (recents.length === 0) {
    return (
      <EmptyState
        icon="search-outline"
        title="Search CareerDeck"
        message="Find a posting a friend mentioned, or look up a company you're curious about."
      />
    );
  }

  return (
    <Animated.View entering={FadeIn.duration(180)} style={styles.recents}>
      <View style={styles.recentsHead}>
        <Text style={styles.recentsTitle}>Recent</Text>
        <Pressable onPress={onClear} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear recent searches">
          <Text style={styles.recentsClear}>Clear</Text>
        </Pressable>
      </View>

      <View style={styles.chips}>
        {recents.map((term) => (
          <Pressable
            key={term}
            onPress={() => onPick(term)}
            accessibilityRole="button"
            accessibilityLabel={`Search again for ${term}`}
            style={({ pressed }) => [styles.chip, pressed ? styles.pressed : null]}>
            <Ionicons name="time-outline" size={14} color={colors.textTertiary} style={styles.chipIcon} />
            <Text style={styles.chipLabel}>{term}</Text>
          </Pressable>
        ))}
      </View>
    </Animated.View>
  );
}

const useStyles = makeStyles((colors) => ({
  scrim: {
    backgroundColor: colors.background,
    opacity: 0.72,
  },
  panel: {
    flex: 1,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: screenPadding,
  },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  input: {
    flex: 1,
    fontSize: fontSize.body,
    color: colors.text,
    // Strips the default vertical padding Android puts on a TextInput, which otherwise
    // pushes the text off-centre inside a fixed-height pill.
    paddingVertical: 0,
  },
  cancel: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  pressed: {
    opacity: 0.6,
  },
  tabs: {
    paddingHorizontal: screenPadding,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  results: {
    paddingHorizontal: screenPadding,
    gap: spacing.md,
  },
  recents: {
    paddingHorizontal: screenPadding,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },
  recentsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  recentsTitle: {
    fontSize: fontSize.small,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.textTertiary,
  },
  recentsClear: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.backgroundMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  chipIcon: {
    marginRight: spacing.xs + 2,
  },
  chipLabel: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.text,
  },
}));
