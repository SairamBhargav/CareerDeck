import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { MarqueeText } from '@/components/common/MarqueeText';
import { fontSize, radius, spacing } from '@/constants/theme';
import { makeStyles, useTheme } from '@/context/ThemeContext';
import type { Resume } from '@/types';
import { formatPostedAt } from '@/utils/format';

export const RESUME_BUBBLE_WIDTH = 148;
/** The card's inset around the page, so the page reads as a sheet laid on the card. */
const INSET = 8;
const PREVIEW_WIDTH = RESUME_BUBBLE_WIDTH - INSET * 2;
const PREVIEW_HEIGHT = 150;

/*
 * The preview renders the page at this width and is then scaled down to the tile.
 *
 * A PDF rendered directly into a 128pt-wide view is a full page squeezed into a thumbnail —
 * the text becomes grey noise and, on iOS, WKWebView's own PDF chrome takes up most of the
 * box. Rendering at a realistic page width and scaling the whole thing down keeps the
 * proportions of an actual document, which is what makes it recognisable at this size.
 */
const RENDER_WIDTH = 420;
const PREVIEW_SCALE = PREVIEW_WIDTH / RENDER_WIDTH;

interface ResumeBubbleProps {
  resume: Resume;
  isDefault: boolean;
  /**
   * A short-lived signed URL for the PDF, when one has been fetched — `useResumePreviewUrls`.
   *
   * Absent (no API service, a failed signing, still in flight) the tile falls back to the
   * glyph, which is why this is optional rather than required: the shelf has to render before
   * and without it.
   */
  previewUri?: string;
  onPress: () => void;
}

/**
 * One stored resume on the Activity shelf.
 *
 * ── The thumbnail, and how it came back ───────────────────────────────────────
 *
 * Through phase 3 this rendered a real page-1 image, because the two resumes in the app were
 * bundled assets with a `.png` next to the `.pdf`. Phase 4 dropped it: a resume uploaded this
 * afternoon has no such image, and rasterising page 1 of an arbitrary PDF means a native
 * dependency or a decoder in the API service, neither of which phase 4 wanted.
 *
 * The replacement — a glyph plus the parse state — lost something real. A shelf of identical
 * document icons does not tell you *which* resume is which, and the file name often cannot
 * either ("Resume - Bhargav Sairam v1.docx (1)"). You recognise your own resume by looking at
 * it.
 *
 * So the page is rendered by the platform's own PDF viewer in a WebView, from the same signed
 * URL the full-screen viewer uses, with no rasteriser anywhere. It is deliberately inert:
 * `pointerEvents="none"` and scrolling off, so the tile stays one tap target and the preview
 * cannot be panned. The parse state only appears when the page cannot speak for itself — still
 * reading, unreadable, not read yet — as a strip along the bottom.
 *
 * A real page-1 raster in the `resume-thumbnails` bucket (which exists, unused, from phase 4)
 * is still the better answer at scale — one image read beats a WebView per tile. This is the
 * version that needs no new dependency and no render pipeline.
 */
export function ResumeBubble({ resume, isDefault, previewUri, onPress }: ResumeBubbleProps) {
  const { colors } = useTheme();
  const styles = useStyles();

  const state = describe(resume);
  const showPreview = previewUri !== undefined && resume.parseStatus !== 'parsing';
  const dot = state.tone === 'bad' ? colors.danger : state.tone === 'good' ? colors.goalMet : colors.textTertiary;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[`Open ${resume.name}`, isDefault ? 'default resume' : null, state.label]
        .filter(Boolean)
        .join(', ')}
      style={({ pressed }) => [
        styles.card,
        isDefault ? styles.cardSelected : null,
        pressed ? styles.pressed : null,
      ]}>
      <View style={styles.preview}>
        {showPreview ? (
          /*
           * Sized to RENDER_WIDTH and scaled down, anchored top-left so the scale pulls the
           * page up into the tile instead of leaving it centred and mostly out of frame.
           */
          <View pointerEvents="none" style={styles.previewClip}>
            <WebView
              source={{ uri: previewUri }}
              style={styles.previewWeb}
              originWhitelist={['*']}
              scrollEnabled={false}
              scalesPageToFit
              // A tile is decoration; it must never be the thing that shows a loading error.
              renderError={() => <View style={styles.previewFallback} />}
              backgroundColor={colors.backgroundMuted}
            />
          </View>
        ) : resume.parseStatus === 'parsing' ? (
          <ActivityIndicator color={colors.textTertiary} />
        ) : (
          <Ionicons
            name={state.icon}
            size={40}
            color={state.tone === 'bad' ? colors.danger : colors.textTertiary}
          />
        )}

        {/* Named rather than a bare checkmark: "default" is what matching reads, and a tick
            on a document reads as "approved". */}
        {isDefault ? (
          <View style={styles.badge}>
            <Ionicons name="checkmark" size={10} color={colors.accentText} />
            <Text style={styles.badgeText}>Default</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.text}>
        {/*
          One line that scrolls itself. A resume's file name is long and the useful part is
          often at the end ("… v2 final"), which an ellipsis would throw away.
        */}
        <MarqueeText style={styles.name}>{resume.name}</MarqueeText>
        <View style={styles.stateRow}>
          <View style={[styles.stateDot, { backgroundColor: dot }]} />
          <Text style={[styles.state, state.tone === 'bad' ? { color: colors.danger } : null]} numberOfLines={1}>
            {state.label} · {formatPostedAt(resume.updatedAt)}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

/**
 * The four parse states, in the words the shelf uses.
 *
 * Every state gets a word now, under the name with a coloured dot (2026-10-09), where it used to
 * be a strip laid over the page for the bad states only. The skill count stays off the tile:
 * it used to sit here, and it was a number competing with the page itself. Its home is the
 * review screen, where it can be acted on.
 */
function describe(resume: Resume): {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  tone: 'good' | 'normal' | 'bad';
} {
  switch (resume.parseStatus) {
    case 'parsed':
      return {
        icon: resume.profile.confirmedAt ? 'checkmark-circle-outline' : 'document-text-outline',
        label: 'Read',
        tone: 'good',
      };
    case 'parsing':
      return { icon: 'document-text-outline', label: 'Reading…', tone: 'normal' };
    case 'failed':
      return { icon: 'alert-circle-outline', label: "Couldn't read", tone: 'bad' };
    default:
      return { icon: 'document-outline', label: 'Not read yet', tone: 'normal' };
  }
}

const useStyles = makeStyles((colors) => ({
  card: {
    width: RESUME_BUBBLE_WIDTH,
    padding: INSET,
    gap: spacing.sm + 2,
    borderRadius: radius.xl - 4,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  cardSelected: {
    borderWidth: 2,
    borderColor: colors.text,
    // The selected card is inset by the thicker border; pull the padding in to match.
    padding: INSET - 1.5,
    ...colors.shadowSoft,
  },
  pressed: {
    opacity: 0.85,
  },
  preview: {
    height: PREVIEW_HEIGHT,
    borderRadius: radius.md + 2,
    backgroundColor: colors.backgroundMuted,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  /*
   * The scaling frame. `width`/`height` are the *rendered* size and the transform shrinks it
   * to the tile; `transformOrigin` top-left means the page's top edge stays at the top of the
   * tile, which is where the name and headline of a resume are.
   */
  previewClip: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: RENDER_WIDTH,
    height: PREVIEW_HEIGHT / PREVIEW_SCALE,
    transform: [{ scale: PREVIEW_SCALE }],
    transformOrigin: 'top left',
  },
  previewWeb: {
    flex: 1,
    backgroundColor: colors.backgroundMuted,
  },
  previewFallback: {
    flex: 1,
    backgroundColor: colors.backgroundMuted,
  },
  badge: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 22,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
  },
  badgeText: {
    fontSize: fontSize.caption - 1,
    fontWeight: '800',
    color: colors.accentText,
  },
  text: {
    paddingHorizontal: 2,
    paddingBottom: 2,
    gap: 3,
  },
  name: {
    fontSize: fontSize.small + 1,
    fontWeight: '800',
    color: colors.text,
    lineHeight: 18,
  },
  stateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  stateDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  state: {
    flex: 1,
    fontSize: fontSize.caption,
    fontWeight: '700',
    color: colors.textSecondary,
  },
}));
