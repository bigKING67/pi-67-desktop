import type { PaletteAction } from "./command-palette-model.js";

export function repairPaletteSelection(
  items: readonly PaletteAction[],
  selectedKey: string | undefined
): string | undefined {
  if (selectedKey && items.some((item) => item.id === selectedKey && !item.disabled)) return selectedKey;
  return items.find((item) => !item.disabled)?.id;
}

export function movePaletteSelection(
  items: readonly PaletteAction[],
  selectedKey: string | undefined,
  direction: -1 | 1
): string | undefined {
  const enabled = items.filter((item) => !item.disabled);
  if (enabled.length === 0) return undefined;
  const currentIndex = enabled.findIndex((item) => item.id === selectedKey);
  if (currentIndex < 0) return direction > 0 ? enabled[0]?.id : enabled.at(-1)?.id;
  return enabled[(currentIndex + direction + enabled.length) % enabled.length]?.id;
}

export function boundaryPaletteSelection(
  items: readonly PaletteAction[],
  boundary: "first" | "last"
): string | undefined {
  const enabled = items.filter((item) => !item.disabled);
  return boundary === "first" ? enabled[0]?.id : enabled.at(-1)?.id;
}
