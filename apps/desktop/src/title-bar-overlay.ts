export interface TitleBarOverlay {
  color: string;
  symbolColor: string;
  height: number;
}

export function titleBarOverlay(shouldUseDarkColors: boolean): TitleBarOverlay {
  return shouldUseDarkColors
    ? { color: "#111412", symbolColor: "#f0f3ef", height: 42 }
    : { color: "#f5f6f4", symbolColor: "#171a18", height: 42 };
}
