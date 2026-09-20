import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn, LinearTransition, SlideInDown, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fontSize, radius, screenPadding, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';

/** Keeps one bad paste from turning the chip row into a wall of text. */
const MAX_ENTRY_LENGTH = 48;
const MAX_ENTRIES = 8;

interface PreferencesSheetProps {
  roles: string[];
  locations: string[];
  onSave: (roles: string[], locations: string[]) => void;
  onClose: () => void;
}

/**
 * The roles and locations the user is actually looking for.
 *
 * These existed on the user record from the start and were never shown anywhere —
 * Profile displayed the *count* of preferred roles and nothing else. They're the only
 * stated signal about what this person wants, so they're worth showing in full and
 * worth being able to change.
 *
 * Edits are held locally and committed on Save, so backing out of the sheet leaves the
 * lists as they were. The caller mounts this only while it's open, which is what seeds
 * the drafts fresh on each visit rather than an effect that re-syncs them.
 */
export function PreferencesSheet({ roles, locations, onSave, onClose }: PreferencesSheetProps) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();

  const [draftRoles, setDraftRoles] = useState(roles);
  const [draftLocations, setDraftLocations] = useState(locations);

  const dirty =
    draftRoles.join('\u0000') !== roles.join('\u0000') ||
    draftLocations.join('\u0000') !== locations.join('\u0000');

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <Animated.View entering={FadeIn.duration(160)} style={StyleSheet.absoluteFill}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close preferences" />
      </Animated.View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.lift}
        pointerEvents="box-none">
        <Animated.View
          entering={SlideInDown.duration(260)}
          style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
          <View style={styles.grabber} />

          <View style={styles.head}>
            <View style={styles.headText}>
              <Text style={styles.title} accessibilityRole="header">
                What you{'’'}re looking for
              </Text>
              <Text style={styles.subtitle}>Used to shape your Deck and the roles we surface.</Text>
            </View>

            <Pressable
              onPress={() => onSave(draftRoles, draftLocations)}
              disabled={!dirty}
              accessibilityRole="button"
              accessibilityLabel="Save preferences"
              accessibilityState={{ disabled: !dirty }}
              style={({ pressed }) => [
                styles.save,
                dirty ? styles.saveActive : null,
                pressed ? styles.pressed : null,
              ]}>
              <Text style={[styles.saveLabel, dirty ? styles.saveLabelActive : null]}>Save</Text>
            </Pressable>
          </View>

          <ChipField
            label="Roles"
            placeholder="Add a role"
            entries={draftRoles}
            onChange={setDraftRoles}
          />

          <ChipField
            label="Locations"
            placeholder="Add a location"
            entries={draftLocations}
            onChange={setDraftLocations}
          />
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

interface ChipFieldProps {
  label: string;
  placeholder: string;
  entries: string[];
  onChange: (entries: string[]) => void;
}

/** A labelled set of removable chips with an inline field for adding another. */
function ChipField({ label, placeholder, entries, onChange }: ChipFieldProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [draft, setDraft] = useState('');

  const full = entries.length >= MAX_ENTRIES;

  const add = () => {
    const value = draft.trim();
    // Case-insensitive, because "Remote" and "remote" are the same preference and a
    // near-duplicate chip looks like a bug.
    const duplicate = entries.some((entry) => entry.toLowerCase() === value.toLowerCase());
    if (!value || duplicate || full) return;

    Haptics.selectionAsync();
    onChange([...entries, value]);
    setDraft('');
  };

  const remove = (entry: string) => {
    Haptics.selectionAsync();
    onChange(entries.filter((current) => current !== entry));
  };

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>

      {/* Chips reflow as they're added and removed rather than jumping to new positions. */}
      <Animated.View layout={LinearTransition.duration(200)} style={styles.chips}>
        {entries.map((entry) => (
          <Animated.View key={entry} entering={ZoomIn.duration(180)} layout={LinearTransition.duration(200)}>
            <Pressable
              onPress={() => remove(entry)}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${entry}`}
              style={({ pressed }) => [styles.chip, pressed ? styles.pressed : null]}>
              <Text style={styles.chipLabel}>{entry}</Text>
              <Ionicons name="close" size={12} color={colors.textTertiary} />
            </Pressable>
          </Animated.View>
        ))}

        {entries.length === 0 ? <Text style={styles.empty}>Nothing set yet.</Text> : null}
      </Animated.View>

      <View style={styles.inputRow}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={add}
          editable={!full}
          placeholder={full ? `That's the ${MAX_ENTRIES} you get` : placeholder}
          placeholderTextColor={colors.textTertiary}
          maxLength={MAX_ENTRY_LENGTH}
          returnKeyType="done"
          style={styles.input}
          accessibilityLabel={placeholder}
        />

        <Pressable
          onPress={add}
          disabled={draft.trim().length === 0 || full}
          accessibilityRole="button"
          accessibilityLabel={placeholder}
          style={({ pressed }) => [
            styles.add,
            draft.trim().length > 0 && !full ? styles.addActive : null,
            pressed ? styles.pressed : null,
          ]}>
          <Ionicons
            name="add"
            size={18}
            color={draft.trim().length > 0 && !full ? colors.accentText : colors.textTertiary}
          />
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
  // The sheet is pinned to the bottom by this wrapper rather than absolutely, so the
  // keyboard can push the whole thing up without it detaching from the edge.
  lift: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    gap: spacing.lg,
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
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  headText: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: fontSize.heading,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
  },
  save: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.backgroundMuted,
  },
  saveActive: {
    backgroundColor: colors.accent,
  },
  saveLabel: {
    fontSize: fontSize.small,
    fontWeight: '700',
    color: colors.textTertiary,
  },
  saveLabelActive: {
    color: colors.accentText,
  },
  pressed: {
    opacity: 0.7,
  },
  field: {
    gap: spacing.sm,
  },
  fieldLabel: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.textTertiary,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm + 2,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.backgroundMuted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  chipLabel: {
    fontSize: fontSize.caption + 1,
    fontWeight: '600',
    color: colors.text,
  },
  empty: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
    paddingVertical: 4,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? spacing.md : spacing.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.background,
    color: colors.text,
    fontSize: fontSize.body,
  },
  add: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.backgroundMuted,
  },
  addActive: {
    backgroundColor: colors.accent,
  },
}));
