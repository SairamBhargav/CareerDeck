import Ionicons from '@expo/vector-icons/Ionicons';
import { AnimatedBlobatar } from '@blobatar/react-native/animated';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, SlideInDown, useReducedMotion, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/common/PrimaryButton';
import { Spinner } from '@/components/common/Spinner';
import { fontSize, radius, screenPadding, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { chooseBlob, fetchBlobOptions } from '@/lib/api';

const BIG = 112;
const OPTION = 76;

interface BlobSheetProps {
  /** The handle the current blob is drawn from. */
  handle: string;
  /** Changes left, from the profile. The server's answer replaces it once it arrives. */
  changesLeft: number;
  /** A new blob was taken: the caller refreshes the profile. */
  onChanged: () => void;
  onClose: () => void;
}

/**
 * Swapping your blob, twice in a lifetime (20261034000000).
 *
 * Three new ones are on offer; tapping one shows it full size in place of yours, and "Use this
 * one" spends a change. "Show me three more" swaps the offer, three times per change. "Keep mine"
 * costs nothing, and the same three are there next time. With no changes left it just says so.
 *
 * Mounted only while open, like the other Profile sheets.
 */
export function BlobSheet({ handle, changesLeft, onChanged, onClose }: BlobSheetProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [picked, setPicked] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const options = useQuery({
    queryKey: ['blobOptions'],
    queryFn: () => fetchBlobOptions(),
    enabled: changesLeft > 0,
    staleTime: Infinity,
  });
  const left = options.data?.left ?? changesLeft;

  // "Three more": a new offer replaces the one shown, and any pick from the old one goes.
  const refresh = useMutation({
    mutationFn: () => fetchBlobOptions(true),
    onSuccess: (next) => {
      void Haptics.selectionAsync();
      setPicked(null);
      setNotice(null);
      queryClient.setQueryData(['blobOptions'], next);
    },
  });

  const choose = useMutation({
    mutationFn: (next: string) => chooseBlob(next),
    onSuccess: (result) => {
      if (result.taken) {
        // Nothing was spent; the offer is gone, so fetch three more.
        setPicked(null);
        setNotice('Someone just got that one. Here are three more.');
        void options.refetch();
        return;
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onChanged();
      onClose();
    },
  });

  const shown = picked ?? handle;
  const offers = options.data?.offers ?? [];
  const refreshesLeft = options.data?.refreshes ?? 0;

  let line: string;
  if (left <= 0) line = 'You’ve used both changes. This one’s yours for good.';
  else if (left === 1) line = 'Pick a new one. This is your last change, ever.';
  else line = `Pick a new one. You can change it ${left} times, ever.`;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <Animated.View entering={FadeIn.duration(160)} style={StyleSheet.absoluteFill}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      </Animated.View>

      <View style={styles.lift} pointerEvents="box-none">
        <Animated.View
          entering={SlideInDown.duration(260)}
          style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.grabber} />

          <Text style={styles.title} accessibilityRole="header">
            Your blob
          </Text>

          <View style={styles.stage}>
            {/* Keyed on the handle, so picking another one pops it in rather than morphing. */}
            <Animated.View key={shown} entering={reduced ? undefined : ZoomIn.springify().damping(14)} style={styles.big}>
              <AnimatedBlobatar name={shown || 'careerdeck'} size={BIG * 0.86} animate={!reduced} />
            </Animated.View>
            <Text style={styles.stageLabel}>{picked ? 'New' : 'Yours now'}</Text>
          </View>

          <Text style={styles.line}>{line}</Text>
          {notice ? <Text style={styles.notice}>{notice}</Text> : null}

          {left > 0 ? (
            options.isLoading || options.isRefetching || refresh.isPending ? (
              <View style={styles.optionsLoading}>
                <Spinner size={22} />
              </View>
            ) : options.isError ? (
              <Pressable onPress={() => void options.refetch()} accessibilityRole="button" style={styles.optionsLoading}>
                <Text style={styles.notice}>Couldn’t load new blobs. Tap to try again.</Text>
              </Pressable>
            ) : (
              <View style={styles.options}>
                {offers.map((offer) => {
                  const selected = offer === picked;
                  return (
                    <Pressable
                      key={offer}
                      onPress={() => {
                        void Haptics.selectionAsync();
                        setPicked(selected ? null : offer);
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={selected ? 'New blob, picked' : 'New blob'}
                      style={({ pressed }) => [styles.option, selected ? styles.optionPicked : null, pressed ? styles.pressed : null]}>
                      <AnimatedBlobatar name={offer} size={OPTION * 0.78} animate={false} />
                    </Pressable>
                  );
                })}
              </View>
            )
          ) : null}

          {left > 0 && options.data ? (
            <Pressable
              onPress={() => refresh.mutate()}
              disabled={refreshesLeft === 0 || refresh.isPending}
              accessibilityRole="button"
              accessibilityState={{ disabled: refreshesLeft === 0 }}
              style={({ pressed }) => [styles.refresh, pressed ? styles.pressed : null]}>
              <Ionicons name="shuffle" size={15} color={refreshesLeft === 0 ? colors.textTertiary : colors.text} />
              <Text style={[styles.refreshLabel, refreshesLeft === 0 ? styles.refreshLabelOff : null]}>
                {refreshesLeft === 0
                  ? 'No more until your next change'
                  : `Show me three more · ${refreshesLeft} left`}
              </Text>
            </Pressable>
          ) : null}
          {refresh.isError ? <Text style={styles.notice}>Couldn’t get more. Try again.</Text> : null}

          {choose.isError ? <Text style={styles.notice}>That didn’t go through. Try again.</Text> : null}

          {left > 0 ? (
            <>
              <PrimaryButton
                label="Use this one"
                onPress={() => picked && choose.mutate(picked)}
                disabled={!picked}
                loading={choose.isPending}
              />
              <PrimaryButton label="Keep mine" variant="ghost" onPress={onClose} />
            </>
          ) : (
            <PrimaryButton label="Done" onPress={onClose} />
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  lift: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    gap: spacing.md,
    paddingHorizontal: screenPadding,
    paddingTop: spacing.sm,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
    marginBottom: spacing.xs,
  },
  title: {
    fontSize: fontSize.heading,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.4,
  },
  stage: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  big: {
    width: BIG,
    height: BIG,
    borderRadius: BIG / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backgroundMuted,
  },
  stageLabel: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textTertiary,
  },
  line: {
    fontSize: fontSize.body,
    lineHeight: 21,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  notice: {
    fontSize: fontSize.small,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  options: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.lg,
    paddingVertical: spacing.xs,
  },
  optionsLoading: {
    height: OPTION + spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  option: {
    width: OPTION,
    height: OPTION,
    borderRadius: OPTION / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backgroundMuted,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  optionPicked: {
    borderColor: colors.text,
  },
  refresh: {
    flexDirection: 'row',
    alignSelf: 'center',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.backgroundMuted,
  },
  refreshLabel: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.text,
  },
  refreshLabelOff: { color: colors.textTertiary },
  pressed: {
    opacity: 0.7,
  },
}));
