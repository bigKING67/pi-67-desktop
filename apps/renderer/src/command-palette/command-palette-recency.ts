const MAX_RECENT_ITEMS = 6;
const recentActionIds: string[] = [];

export function rememberPaletteAction(id: string): void {
  const existing = recentActionIds.indexOf(id);
  if (existing >= 0) recentActionIds.splice(existing, 1);
  recentActionIds.unshift(id);
  if (recentActionIds.length > MAX_RECENT_ITEMS) recentActionIds.length = MAX_RECENT_ITEMS;
}

export function getRecentPaletteActionIds(): readonly string[] {
  return [...recentActionIds];
}

export function resetPaletteRecencyForTest(): void {
  recentActionIds.length = 0;
}
