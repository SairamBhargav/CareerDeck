function channels(hex: string): [number, number, number] | null {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const value = Number.parseInt(full, 16);
  if (full.length !== 6 || Number.isNaN(value)) return null;
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const toHex = (rgb: [number, number, number]) =>
  `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;

/**
 * A brand colour that can be seen on `background`: unchanged when it already contrasts by
 * `minRatio`, otherwise mixed toward white (on a dark page) or black (on a light one) until it
 * does. Stripe's navy ring on near-black, or a white brand's ring on white, stays that
 * brand's hue but becomes visible. Bad input comes back as given.
 */
export function legibleOn(hex: string, background: string, minRatio = 3): string {
  const color = channels(hex);
  const page = channels(background);
  if (!color || !page) return hex;
  if (contrast(color, page) >= minRatio) return hex;

  const target: [number, number, number] = luminance(page) < 0.5 ? [255, 255, 255] : [0, 0, 0];
  for (let step = 1; step <= 10; step += 1) {
    const t = step / 10;
    const mixed = color.map((c, i) => c + (target[i]! - c) * t) as [number, number, number];
    if (contrast(mixed, page) >= minRatio) return toHex(mixed);
  }
  return toHex(target);
}

/** "#76B900" + 0.08 -> "rgba(118, 185, 0, 0.08)". Falls back to transparent for bad input. */
export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const value = Number.parseInt(full, 16);

  if (full.length !== 6 || Number.isNaN(value)) return 'transparent';

  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
