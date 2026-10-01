/**
 * OpenViking 0.4.22 maps local cosine scores from [-1, 1] to (cos + 1) / 2
 * (#5358) without adjusting caller thresholds. Pi-67 keeps every configured
 * threshold and safety gate in raw cosine, so saved user values keep their
 * meaning across server versions, and converts only at the request boundary.
 */
export type ServerScoreScale = "raw-cosine" | "normalized-cosine";

/**
 * Unknown versions are treated as normalized: against an older server that only
 * makes Recall stricter, never floods context with low-similarity entries.
 */
export function scoreScaleForVersion(version: unknown): ServerScoreScale {
  const match = typeof version === "string" ? /^(\d+)\.(\d+)\.(\d+)/u.exec(version.trim()) : null;
  if (!match) return "normalized-cosine";
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const older = major === 0 && (minor < 4 || (minor === 4 && patch < 22));
  return older ? "raw-cosine" : "normalized-cosine";
}

export function toServerScore(rawCosine: number, scale: ServerScoreScale): number {
  return scale === "normalized-cosine" ? (rawCosine + 1) / 2 : rawCosine;
}

export function toRawCosine(serverScore: number, scale: ServerScoreScale): number {
  return scale === "normalized-cosine" ? serverScore * 2 - 1 : serverScore;
}
