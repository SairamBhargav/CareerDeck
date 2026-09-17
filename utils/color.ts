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
