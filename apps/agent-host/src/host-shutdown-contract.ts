export function shutdownDeadline(value: number): number {
  if (!Number.isSafeInteger(value) || value < 100 || value > 10_000) {
    throw new RangeError("deadlineMs must be an integer between 100 and 10000.");
  }
  return value;
}

export function boundedMetadataCount(value: number): number {
  return Math.max(0, Math.min(10_000, Number.isSafeInteger(value) ? value : 0));
}
