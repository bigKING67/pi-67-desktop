import type {
  RuntimeInitializationObserver,
  RuntimeInitializationStage
} from "./agent-runtime.js";

export function reportRuntimeInitializationStage(
  observer: RuntimeInitializationObserver | undefined,
  stage: RuntimeInitializationStage
): void {
  try {
    observer?.(stage);
  } catch {
    // Observability must not change Pi Runtime initialization behavior.
  }
}
