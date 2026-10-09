import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, Text, TextInput, View } from 'react-native';

import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import { reactionGifs } from '@/data/mockGifs';
import { useGifSearch } from '@/hooks/useGifs';
import { isKlipyConfigured, klipyGifId, type KlipyGif } from '@/lib/klipy';

const COLUMNS = 3;
const PANEL_HEIGHT = 260;

interface GifPickerProps {
  /** `gifId` is what the comment stores; `slug` is set for a KLIPY GIF so the caller can report the share. */
  onPick: (gifId: string, slug?: string) => void;
}

/**
 * The composer's GIF panel, Instagram-style: a search box over a grid, trending until you type.
 *
 * With no KLIPY key on the build it is the eight bundled reactions, as it was before. The two are
 * never shown together, because KLIPY's terms keep their results in a grid of their own.
 */
export function GifPicker({ onPick }: GifPickerProps) {
  return isKlipyConfigured ? <KlipyPicker onPick={onPick} /> : <BundledPicker onPick={onPick} />;
}

function KlipyPicker({ onPick }: GifPickerProps) {
  const { colors } = useTheme();
  const styles = useStyles();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const { gifs, isSearching, isLoading, isError, hasMore, loadMore, isLoadingMore, retry } =
    useGifSearch(query, true);

  const renderTile = ({ item }: { item: KlipyGif }) => (
    <Pressable
      onPress={() => {
        // The row that is about to appear asks for this slug. It is already in hand, so the
        // writer sees their GIF immediately instead of after a lookup.
        queryClient.setQueryData(['klipy', 'gif', item.slug], item);
        onPick(klipyGifId(item.slug), item.slug);
      }}
      accessibilityRole="button"
      accessibilityLabel={`Post the ${item.title} GIF`}
      style={({ pressed }) => [styles.tile, pressed ? styles.pressed : null]}>
      <Image source={{ uri: item.preview.url }} style={styles.image} resizeMode="cover" />
    </Pressable>
  );

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
        <Text style={styles.message}>{isSearching ? `No GIFs for “${query.trim()}”.` : 'Nothing trending right now.'}</Text>
      </View>
    );
  } else {
    body = (
      <FlatList
        data={gifs}
        keyExtractor={(gif) => gif.slug}
        renderItem={renderTile}
        numColumns={COLUMNS}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.grid}
        onEndReached={hasMore ? loadMore : undefined}
        onEndReachedThreshold={0.6}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        ListFooterComponent={
          isLoadingMore ? <ActivityIndicator style={styles.footer} color={colors.textTertiary} /> : null
        }
      />
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
          <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
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

function BundledPicker({ onPick }: GifPickerProps) {
  const styles = useStyles();
  return (
    <View style={styles.bundled}>
      {reactionGifs.map((gif) => (
        <Pressable
          key={gif.id}
          onPress={() => onPick(gif.id)}
          accessibilityRole="button"
          accessibilityLabel={'Post the ' + gif.label + ' GIF'}
          style={({ pressed }) => [styles.bundledTile, pressed ? styles.pressed : null]}>
          <Image source={gif.source} style={styles.image} resizeMode="cover" />
        </Pressable>
      ))}
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
  grid: {
    gap: 4,
  },
  row: {
    gap: 4,
  },
  tile: {
    flex: 1 / COLUMNS,
    aspectRatio: 1,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.backgroundMuted,
  },
  image: {
    width: '100%',
    height: '100%',
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
  bundled: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  bundledTile: {
    width: '25%',
    flexGrow: 1,
    flexBasis: '19%',
    aspectRatio: 4 / 3,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.backgroundMuted,
  },
  pressed: {
    opacity: 0.7,
  },
}));
