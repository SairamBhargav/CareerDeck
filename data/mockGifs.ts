import type { ImageSourcePropType } from 'react-native';

export interface ReactionGif {
  id: string;
  /** Read out by screen readers, and shown under the tile in the picker. */
  label: string;
  source: ImageSourcePropType;
}

/**
 * The GIF picker's contents. Bundled as real animated assets rather than fetched, so
 * the picker works with no network, no API key and no third-party CDN that can rot —
 * the same reason the resumes ship as local PDFs.
 *
 * A real integration (Giphy, Tenor) replaces this file and the `source` field becomes
 * a remote URI. Nothing else about the comment flow has to change.
 */
export const reactionGifs: ReactionGif[] = [
  { id: 'lgtm', label: 'LGTM', source: require('@/assets/gifs/lgtm.gif') },
  { id: 'same', label: 'same', source: require('@/assets/gifs/same.gif') },
  { id: 'applied', label: 'applied', source: require('@/assets/gifs/applied.gif') },
  { id: 'waiting', label: 'waiting', source: require('@/assets/gifs/waiting.gif') },
  { id: 'ghosted', label: 'ghosted', source: require('@/assets/gifs/ghosted.gif') },
  { id: 'lfg', label: 'LFG', source: require('@/assets/gifs/lfg.gif') },
  { id: 'rip', label: 'rip', source: require('@/assets/gifs/rip.gif') },
  { id: 'noway', label: 'no way', source: require('@/assets/gifs/noway.gif') },
];

const byId = new Map(reactionGifs.map((gif) => [gif.id, gif]));

/** Undefined for an id that no longer ships — the row then renders as a plain comment. */
export function gifById(id: string | undefined): ReactionGif | undefined {
  return id === undefined ? undefined : byId.get(id);
}
