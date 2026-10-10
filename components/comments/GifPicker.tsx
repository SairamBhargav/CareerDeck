import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { fontSize, radius, screenPadding, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { reactionGifs } from '@/data/mockGifs';
import { useGifSearch } from '@/hooks/useGifs';
import { isKlipyConfigured, klipyGifId, type KlipyGif } from '@/lib/klipy';

/*
 * Two columns for search results, three for the bundled set.
 *
 * Search results are whatever KLIPY returns, which is mostly landscape clips off film and TV, and
 * two columns is the width at which those are still readable — you are picking by recognising a
 * face or a caption, and a 110pt-wide tile of a wide clip is too small to recognise anything in.
 * The bundled set is eight 4:3 reactions that are already familiar, so they can be smaller and all
 * eight can be on screen at once.
 */
const KLIPY_COLUMNS = 2;
const BUNDLED_COLUMNS = 3;

const GAP = 6;
const PANEL_HEIGHT = 260;

/** How close to the end of the scroll to be before asking for another page. */
const LOAD_MORE_SLACK = 260;

/*
 * Nothing is allowed to be wilder than this.
 *
 * KLIPY carries the occasional 1000x200 banner and the occasional near-vertical phone clip, and one
 * of those in a column makes every tile below it in that column tiny or enormous. Clamping means an
 * extreme is cropped a little by `cover` instead, which is the trade every GIF picker makes.
 */
const MIN_ASPECT = 0.7;
const MAX_ASPECT = 2.2;

interface GifPickerProps {
  /** `gifId` is what the comment stores; `slug` is set for a KLIPY GIF so the caller can report the share. */
  onPick: (gifId: string, slug?: string) => void;
}

/**
 * The composer's GIF panel: a search box over a grid, trending until you type.
 *
 * With no KLIPY key on the build it is the eight bundled reactions, as it was before. The two are
 * never shown together, because KLIPY's terms keep their results in a grid of their own.
 */
export function GifPicker({ onPick }: GifPickerProps) {
  return isKlipyConfigured ? <KlipyPicker onPick={onPick} /> : <BundledPicker onPick={onPick} />;
}

/**
 * The width one tile gets, in points.
 *
 * Computed from the window rather than measured with `onLayout`, because the panel always spans the
 * sheet less the composer's padding and that is known up front — and a measured width arrives one
 * frame late, which is a frame of the grid at the wrong size.
 */
function useTileWidth(columns: number): number {
  const { width } = useWindowDimensions();
  return (width - screenPadding * 2 - GAP * (columns - 1)) / columns;
}

/** A GIF's own proportions, kept inside the clamp above. 1 when KLIPY sent no usable size. */
function aspectOf(gif: KlipyGif): number {
  const raw = gif.preview.width / gif.preview.height;
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  return Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, raw));
}

/**
 * Deals the results into columns, shortest column first.
 *
 * This is the masonry every GIF picker uses, and the reason is that the alternative is what this
 * panel used to do: force a square tile and `cover` it. A square crop takes the sides off a 16:9
 * clip, which is where the caption and usually the face are, so the grid was tidy and the GIFs were
 * unrecognisable.
 *
 * Shortest-first rather than round-robin, because round-robin leaves one column hanging well below
 * the other as soon as the aspect ratios differ, and the ragged bottom is the thing that reads as
 * broken.
 */
function toColumns(gifs: KlipyGif[], columns: number): KlipyGif[][] {
  const out: KlipyGif[][] = Array.from({ length: columns }, () => []);
  // Height per unit of width, so these are comparable without knowing the tile width yet.
  const used = new Array<number>(columns).fill(0);

  for (const gif of gifs) {
    let shortest = 0;
    let shortestUsed = used[0] ?? 0;
    for (let i = 1; i < columns; i += 1) {
      const height = used[i] ?? 0;
      if (height < shortestUsed) {
        shortest = i;
        shortestUsed = height;
      }
    }
    out[shortest]?.push(gif);
    used[shortest] = shortestUsed + 1 / aspectOf(gif);
  }

  return out;
}

function KlipyPicker({ onPick }: GifPickerProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const { gifs, isSearching, isLoading, isError, hasMore, loadMore, isLoadingMore, retry } =
    useGifSearch(query, true);

  const tileWidth = useTileWidth(KLIPY_COLUMNS);

  /*
   * A masonry cannot be a FlatList: `numColumns` lays out in rows, and a row is as tall as its
   * tallest cell, which is the square-tile problem again with extra gaps. So the scrolling is ours,
   * and so is noticing the end of it.
   */
  const onScroll = ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!hasMore || isLoadingMore) return;
    const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
    const remaining = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    if (remaining < LOAD_MORE_SLACK) loadMore();
  };

  let body: React.ReactNode;
  if (isLoading) {
    body = (
      <View style={styles.center}>
        <ActivityIndicator color={colors.textTertiary} />
      </View>
    );
  } else if (isError && gifs.length === 0) {
    body = (
      <Pressable onPress={retry} style={styles.center} accessibilityRole="button">
        <Text style={styles.message}>GIFs did not load. Tap to try again.</Text>
      </Pressable>
    );
  } else if (gifs.length === 0) {
    body = (
      <View style={styles.center}>
        <Text style={styles.message}>
          {isSearching ? `No GIFs for “${query.trim()}”.` : 'Nothing trending right now.'}
        </Text>
      </View>
    );
  } else {
    body = (
      <ScrollView
        onScroll={onScroll}
        scrollEventThrottle={64}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <View style={styles.masonry}>
          {toColumns(gifs, KLIPY_COLUMNS).map((column, index) => (
            // The key is the column slot, not its contents — there are exactly `columns` of them
            // and they never reorder.
            <View key={index} style={styles.column}>
              {column.map((gif) => (
                <Pressable
                  key={gif.slug}
                  onPress={() => {
                    // The row that is about to appear asks for this slug. It is already in hand, so
                    // the writer sees their GIF immediately instead of after a lookup.
                    queryClient.setQueryData(['klipy', 'gif', gif.slug], gif);
                    onPick(klipyGifId(gif.slug), gif.slug);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Post the ${gif.title} GIF`}
                  style={({ pressed }) => [styles.tile, pressed ? styles.pressed : null]}>
                  <Image
                    source={{ uri: gif.preview.url }}
                    // Its own proportions. `cover` still earns its keep on the clamped extremes.
                    style={{ width: tileWidth, height: tileWidth / aspectOf(gif) }}
                    resizeMode="cover"
                  />
                </Pressable>
              ))}
            </View>
          ))}
        </View>

        {isLoadingMore ? <ActivityIndicator style={styles.footer} color={colors.textTertiary} /> : null}
      </ScrollView>
    );
  }

  return (
    <View style={styles.panel}>
      <View style={styles.searchRow}>
        <Ionicons name="search" size={15} color={colors.textTertiary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search KLIPY"
          placeholderTextColor={colors.textTertiary}
          style={styles.search}
          returnKeyType="search"
          autoCorrect={false}
          accessibilityLabel="Search GIFs"
        />
        {query.length > 0 ? (
          <Pressable
            onPress={() => setQuery('')}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.results}>{body}</View>

      {/* KLIPY's terms require their branding wherever their content appears. */}
      <Text style={styles.attribution}>Powered by KLIPY</Text>
    </View>
  );
}

/**
 * The eight bundled reactions, on a build with no KLIPY key.
 *
 * All eight are 240x180, so this needs no masonry — one aspect ratio, three to a row, and they fit
 * on screen without scrolling. It gets the same panel height as the search grid so that opening the
 * picker moves the composer by the same amount either way.
 */
function BundledPicker({ onPick }: GifPickerProps) {
  const styles = useStyles();
  const tileWidth = useTileWidth(BUNDLED_COLUMNS);

  return (
    <View style={styles.panel}>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.bundled}>
          {reactionGifs.map((gif) => (
            <Pressable
              key={gif.id}
              onPress={() => onPick(gif.id)}
              accessibilityRole="button"
              accessibilityLabel={`Post the ${gif.label} GIF`}
              style={({ pressed }) => [styles.tile, pressed ? styles.pressed : null]}>
              <Image
                source={gif.source}
                // 4:3, which is what all eight actually are — so nothing is cropped.
                style={{ width: tileWidth, height: (tileWidth * 3) / 4 }}
                resizeMode="cover"
              />
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  panel: {
    height: PANEL_HEIGHT,
    gap: spacing.sm,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 36,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.backgroundMuted,
  },
  search: {
    flex: 1,
    paddingVertical: 0,
    color: colors.text,
    fontSize: fontSize.small,
  },
  results: {
    flex: 1,
  },
  masonry: {
    flexDirection: 'row',
    // Each column sizes to its tiles, so nothing here may stretch them to match its neighbour.
    alignItems: 'flex-start',
    gap: GAP,
  },
  column: {
    gap: GAP,
  },
  bundled: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GAP,
  },
  /*
   * The tile is a clip frame and nothing else — the Image inside carries the size.
   *
   * That is the fix for the squish. The tile used to set `width: '25%'`, `flexBasis: '19%'`,
   * `flexGrow: 1` and `aspectRatio: 4/3` all at once: three competing opinions about the main axis
   * and a fourth deriving the cross axis from whichever of them won. Yoga resolved it to a box
   * whose ratio was not 4:3, the Image filled it with `cover`, and `cover` crops — so every
   * reaction was a zoomed-in slice of itself, about 80pt wide and four to a row.
   *
   * Now the width is a number of points and the height is that number times the clip's real ratio,
   * so the frame is exactly the shape of what goes in it and there is nothing left to crop.
   */
  tile: {
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: colors.backgroundMuted,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: {
    fontSize: fontSize.caption,
    color: colors.textTertiary,
  },
  footer: {
    paddingVertical: spacing.sm,
  },
  attribution: {
    alignSelf: 'flex-end',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
    color: colors.textTertiary,
  },
  pressed: {
    opacity: 0.7,
  },
}));
