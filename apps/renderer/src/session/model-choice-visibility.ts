/** Presentation only: keep Pi's catalog and historical model identities intact. */
export function visibleModelChoices<T extends { id: string }>(
  provider: string,
  models: readonly T[],
  selectedId: string | undefined
): readonly T[] {
  // DeepSeek documents these as retired aliases of deepseek-flash:
  // https://api-docs.deepseek.com/updates/ (2026-09-10).
  // Never invent a replacement when Pi has not supplied the canonical model.
  if (provider !== "deepseek" || !models.some((model) => model.id === "deepseek-flash")) return models;
  return models.filter((model) => model.id === selectedId || (
    model.id !== "deepseek-v4-flash" && model.id !== "deepseek-v4-flash-vision-exp"
  ));
}
