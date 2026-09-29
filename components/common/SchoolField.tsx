import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { SCHOOLS, schoolById, searchSchools, type School } from '@/constants/schools';
import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';

/**
 * A school field that resolves what somebody types to one row in the federal directory.
 *
 * ── Why this is not just a text input ─────────────────────────────────────────
 *
 * "CU Boulder", "Boulder" and "University of Colorado" are one school, and a text input
 * makes them three. That matters beyond tidiness: `profiles.school_id_claimed` is what
 * the ranker's cohort signal joins on — "students at your school applied to these" — and
 * a join on free text matches nobody.
 *
 * Matching is `searchSchools` in constants/schools.ts, over a list bundled with the app.
 * No network, no debounce, no spinner: the directory cannot change between releases, so
 * a round trip per keystroke would buy nothing and cost everything.
 *
 * ── The escape hatch is deliberate ────────────────────────────────────────────
 *
 * `onChangeText` fires on every keystroke whether or not anything was picked, and the
 * parent keeps that text. A bootcamp, an institution too new to be listed, a school that
 * simply is not in IPEDS — none of them should hit a wall on a sign-up form. Picking a
 * suggestion additionally reports an IPEDS id; not picking one reports null and the typed
 * text stands on its own.
 *
 * The list is US-only, which is the product's scope. Somebody outside it types and
 * continues rather than being told their school does not exist.
 */

export interface SchoolFieldProps {
  label?: string;
  /** The raw text, which the parent owns so it survives this component unmounting. */
  value: string;
  onChangeText: (next: string) => void;
  /** IPEDS UNITID once a suggestion is picked, null while it is free text. */
  ipedsId: number | null;
  onPick: (id: number | null) => void;
  placeholder?: string;
}

export function SchoolField({
  label = 'School',
  value,
  onChangeText,
  ipedsId,
  onPick,
  placeholder = 'Start typing — e.g. CU Boulder',
}: SchoolFieldProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);

  const picked = useMemo(() => schoolById(ipedsId), [ipedsId]);

  /*
   * Suggestions are hidden once something is picked *and* the text still matches it.
   * Editing after picking re-opens the list, because the edit is the user saying the
   * pick was wrong — and leaving a stale confirmation under a changed string is how
   * somebody ends up attached to a school they did not choose.
   */
  const matchesPick = picked !== undefined && picked.name === value;

  const suggestions = useMemo(
    () => (matchesPick ? [] : searchSchools(value)),
    [value, matchesPick],
  );

  const showList = focused && !matchesPick && suggestions.length > 0;

  const choose = (school: School) => {
    Haptics.selectionAsync();
    onChangeText(school.name);
    onPick(school.id);
  };

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>

      <TextInput
        value={value}
        onChangeText={(next) => {
          onChangeText(next);
          // Any edit invalidates the pick. Re-picking is one tap; being silently
          // attached to the wrong school is not recoverable by the user at all.
          if (ipedsId !== null) onPick(null);
        }}
        onFocus={() => setFocused(true)}
        // Not dismissed on blur: a tap on a suggestion blurs the input first, and
        // hiding the list on blur means the tap lands on nothing.
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        autoCapitalize="words"
        autoCorrect={false}
        style={styles.input}
        accessibilityLabel={label}
      />

      {matchesPick ? (
        <Text style={styles.confirmed} accessibilityLiveRegion="polite">
          {picked.state ? `${picked.state} · ` : ''}matched to the directory
        </Text>
      ) : null}

      {showList ? (
        <View style={styles.list}>
          {suggestions.map((school) => (
            <Pressable
              key={school.id}
              onPress={() => choose(school)}
              accessibilityRole="button"
              accessibilityLabel={`${school.name}${school.state ? `, ${school.state}` : ''}`}
              style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}>
              <Text style={styles.name} numberOfLines={1}>
                {school.name}
              </Text>
              <Text style={styles.meta} numberOfLines={1}>
                {school.state}
                {school.alt && school.alt.length > 0 ? ` · ${school.alt.slice(0, 3).join(', ')}` : ''}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* Only once they have typed enough for the search to have genuinely tried and
          found nothing — below two characters it returns nothing by design. */}
      {focused && !matchesPick && value.trim().length >= 2 && suggestions.length === 0 ? (
        <Text style={styles.miss}>
          Not in the directory — what you typed will be saved as-is.
        </Text>
      ) : null}
    </View>
  );
}

/** Exported for tests and for anything that wants to size the list. */
export const SCHOOL_COUNT = SCHOOLS.length;

const useStyles = makeStyles((colors) => ({
  field: {
    // Stretch, not hug. Without an explicit width the field is sized by its widest child,
    // which is a suggestion row holding an arbitrarily long school name.
    alignSelf: 'stretch',
    width: '100%',
    gap: spacing.sm,
  },
  label: {
    fontSize: fontSize.small,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  input: {
    minHeight: 48,
    paddingHorizontal: spacing.md + 2,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    fontSize: fontSize.body,
    color: colors.text,
  },
  confirmed: {
    fontSize: fontSize.small,
    color: colors.textTertiary,
  },
  list: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  row: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md + 2,
    gap: 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  name: {
    // numberOfLines truncates the render, not the measurement — without flexShrink the
    // row still asks for the full intrinsic width and pushes everything around it.
    flexShrink: 1,
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.text,
  },
  meta: {
    flexShrink: 1,
    fontSize: fontSize.small,
    color: colors.textTertiary,
  },
  miss: {
    fontSize: fontSize.small,
    lineHeight: 18,
    color: colors.textTertiary,
  },
  pressed: {
    opacity: 0.7,
  },
}));
