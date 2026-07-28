export type MockPayloadSanitizer = (
  type: string,
  payload: Record<string, unknown> | undefined
) => unknown;

export function installMockPayloadSanitizer(): void {
  (window as typeof window & {
    __pi67SanitizeMockPayload?: MockPayloadSanitizer;
  }).__pi67SanitizeMockPayload = (type, payload) => {
    if (!payload) return {};
    if (
      type === "model.setRuntimeKey"
      || type === "provider.setRuntimeKey"
      || type === "provider.credential.store"
    ) return { ...payload, apiKey: "[redacted]" };
    if (type === "provider.configuration.save") {
      const provider = payload.provider as Record<string, unknown> | undefined;
      const redactHeaders = (value: unknown) => Array.isArray(value)
        ? value.map((item) => {
            const mutation = item as Record<string, unknown>;
            return { ...mutation, ...(mutation.value === undefined ? {} : { value: "[redacted]" }) };
          })
        : value;
      const models = Array.isArray(provider?.models)
        ? provider.models.map((value) => {
            const model = value as Record<string, unknown>;
            return { ...model, headers: redactHeaders(model.headers) };
          })
        : provider?.models;
      return {
        ...payload,
        provider: provider === undefined
          ? provider
          : { ...provider, headers: redactHeaders(provider.headers), models }
      };
    }
    if (type !== "prompt.submit") return payload;
    const images = Array.isArray(payload.images) ? payload.images : [];
    return {
      ...payload,
      images: images.map((image) => {
        const value = image as { name?: unknown; mimeType?: unknown; data?: ArrayBuffer };
        return { name: value.name, mimeType: value.mimeType, bytes: value.data?.byteLength ?? 0 };
      })
    };
  };
}
