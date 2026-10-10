import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { GestureDetector, type NativeGesture } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  type SharedValue,
  useAnimatedScrollHandler,
  useSharedValue,
} from 'react-native-reanimated';

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
  /**
   * Take all the height there is, instead of the panel's own 260.
   *
   * Set when the picker is the whole sheet rather than a tray above the composer. Browsing is the
   * task at that point, so the grid gets the room and the thread waits underneath.
   */
  fill?: boolean;
  /**
   * Where the grid is scrolled to, published for the parent.
   *
   * The sheet's drag-to-dismiss may only engage while the grid is at its top; below that a
   * downward drag is somebody scrolling back up through GIFs. Same contract the comment thread
   * has with the same gesture.
   */
  scrollY?: SharedValue<number>;
  /** The parent's `Gesture.Native()` stand-in, so its pan and this scroll recognise together. */
  listGesture?: NativeGesture;
}

/**
 * The composer's GIF panel: a search box over a grid, trending until you type.
 *
 * With no KLIPY key on the build it is the eight bundled reactions, as it was before. The two are
 * never shown together, because KLIPY's terms keep their results in a grid of their own.
 */
export function GifPicker({ onPick, fill = false, scrollY, listGesture }: GifPickerProps) {
  return isKlipyConfigured ? (
    <KlipyPicker onPick={onPick} fill={fill} scrollY={scrollY} listGesture={listGesture} />
  ) : (
    <BundledPicker onPick={onPick} fill={fill} scrollY={scrollY} listGesture={listGesture} />
  );
}

/**
 * The grid's scroller: an `Animated.ScrollView`, handed to the parent's native gesture when there
 * is one so its pan and this scroll recognise simultaneously instead of cancelling each other.
 */
function Scroller({
  listGesture,
  onScroll,
  children,
}: {
  listGesture?: NativeGesture;
  onScroll?: ReturnType<typeof useAnimatedScrollHandler>;
  children: React.ReactNode;
}) {
  const view = (
    <Animated.ScrollView
      onScroll={onScroll}
      scrollEventThrottle={16}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}>
      {children}
    </Animated.ScrollView>
  );

  return listGesture ? <GestureDetector gesture={listGesture}>{view}</GestureDetector> : view;
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

function KlipyPicker({ onPick, fill = false, scrollY, listGesture }: GifPickerProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const { gifs, isSearching, isLoading, isError, hasMore, loadMore, isLoadingMore, retry } =
    useGifSearch(query, true);

  const tileWidth = useTileWidth(KLIPY_COLUMNS);

  const requestMore = () => {
    if (hasMore && !isLoadingMore) loadMore();
  };

  /*
   * A masonry cannot be a FlatList: `numColumns` lays out in rows, and a row is as tall as its
   * tallest cell, which is the square-tile problem again with extra gaps. So the scrolling is ours,
   * and so is noticing the end of it.
   *
   * On the UI thread, because the offset it publishes is read by a gesture that also runs there —
   * a JS-thread handler would have the pan deciding "is the grid at its top" from a frame-old
   * answer, which is wrong exactly when somebody flicks up and immediately drags down.
   */
  const asked = useSharedValue(false);
  const onScroll = useAnimatedScrollHandler((event) => {
    'worklet';
    if (scrollY) scrollY.set(event.contentOffset.y);

    const remaining =
      event.contentSize.height - (event.contentOffset.y + event.layoutMeasurement.height);
    // Latched, so nearing the end asks once rather than on every frame of the glide. It clears
    // itself as soon as the content grows or the reader scrolls back up.
    if (remaining < LOAD_MORE_SLACK) {
      if (!asked.value) {
        asked.value = true;
        runOnJS(requestMore)();
      }
    } else {
      asked.value = false;
    }
  });

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
      <Scroller listGesture={listGesture} onScroll={onScroll}>
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
      </Scroller>
    );
  }

  return (
    <View style={fill ? styles.panelFill : styles.panel}>
      <View style={styles.searchLine}>
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

        {/* KLIPY's terms require their branding wherever their content appears. Beside the search
            box rather than on a line of its own, where it was costing the grid a row to say it. */}
        <Text style={styles.attribution}>Powered by KLIPY</Text>
      </View>

      <View style={styles.results}>{body}</View>
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
function BundledPicker({ onPick, fill = false, scrollY, listGesture }: GifPickerProps) {
  const styles = useStyles();
  const tileWidth = useTileWidth(BUNDLED_COLUMNS);

  const onScroll = useAnimatedScrollHandler((event) => {
    'worklet';
    if (scrollY) scrollY.set(event.contentOffset.y);
  });

  return (
    <View style={fill ? styles.panelFill : styles.panel}>
      <Scroller listGesture={listGesture} onScroll={onScroll}>
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
      </Scroller>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  panel: {
    height: PANEL_HEIGHT,
    gap: spacing.sm,
  },
  // The whole-sheet variant: the parent decides the height and the grid takes what is left.
  panelFill: {
    flex: 1,
    gap: spacing.sm,
  },
  searchLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  searchRow: {
    flex: 1,
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
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
    color: colors.textTertiary,
  },
  pressed: {
    opacity: 0.7,
  },
}));
