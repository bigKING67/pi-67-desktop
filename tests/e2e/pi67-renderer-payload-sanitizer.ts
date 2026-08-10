export type MockPayloadSanitizer = (
  type: string,
  payload: Record<string, unknown> | undefined
) => Promise<unknown>;

export function installMockPayloadSanitizer(): void {
  (window as typeof window & {
    __pi67SanitizeMockPayload?: MockPayloadSanitizer;
  }).__pi67SanitizeMockPayload = async (type, payload) => {
    if (!payload) return {};
    if (type === "context.file.save") {
      const { content, ...metadata } = payload;
      const bytes = new TextEncoder().encode(typeof content === "string" ? content : "");
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const sha256 = [...new Uint8Array(digest)]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("");
      return { ...metadata, content: { byteLength: bytes.byteLength, sha256 } };
    }
    if (
      type === "model.setRuntimeKey"
      || type === "provider.setRuntimeKey"
      || type === "provider.credential.store"
    ) return { ...payload, apiKey: "[redacted]" };
    if (type === "lark.app.configuration.save") {
      return { ...payload, appSecret: "[redacted]" };
    }
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
    const attachments = Array.isArray(payload.attachments) ? payload.attachments : [];
    return {
      ...payload,
      attachments: attachments.map((attachment) => {
        const value = attachment as { id?: unknown };
        return { id: value.id };
      })
    };
  };
}
