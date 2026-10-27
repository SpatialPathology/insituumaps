import { ColorUtils, findColorPalette } from "@tissuumaps/core";

/** The CSS gradient of a continuous palette */
export function paletteGradient(paletteId: string): string {
  const palette = findColorPalette(paletteId);
  if (palette === undefined) {
    return "linear-gradient(to right, #000, #fff)";
  }
  const n = palette.colors.length;
  const stops = Array.from({ length: Math.min(n, 32) }, (_, i) => {
    const color =
      palette.colors[Math.round((i / (Math.min(n, 32) - 1)) * (n - 1))]!;
    return ColorUtils.toHex(color);
  });
  return `linear-gradient(to right, ${stops.join(", ")})`;
}
