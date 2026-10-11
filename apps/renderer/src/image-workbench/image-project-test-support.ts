import { ProtocolRequestError } from "@pi67/protocol";

// The image page's controller tests share one scripted Agent connection: `host` holds what the
// Host would answer and every call it was sent; `notices` collects published notifications.

export const host = {
  revision: 1, calls: [] as { type: string; payload: Record<string, unknown> }[], conflictNext: false,
  refuseNext: undefined as { message: string; imageReason: string } | undefined, objectIds: ["t", "u"], unreadNext: false,
  brand: { schema: "newmoney.image-brand.v1", revision: 0, colors: [], fonts: [], logos: [], specs: [] } as { revision: number; [key: string]: unknown }
};
export const notices = [] as { level: string; title: string; message: string }[];

/** The Agent connection, answering image commands from `host`. */
export const mockConnection = {
  agentConnectionController: {
    subscribe: () => () => undefined,
    request: (type: string, payload: Record<string, unknown>) => {
      host.calls.push({ type, payload });
      if (type === "image.project.read") return Promise.resolve({ projectId: "p", revision: host.revision, latestRevision: host.revision, sha256: "s", document: { title: "海报", canvas: { width: 100, height: 100, background: "#fff" }, assets: [], objects: host.objectIds.map((id) => ({ id, kind: "rect", locked: false, visible: true, x: 0, y: 0, width: 10, height: 10, opacity: 1, color: "#000000", radius: 0 })) } });
      if (type === "image.project.render") return Promise.resolve({ projectId: "p", revision: host.revision, pngSha256: "a".repeat(64), width: 100, height: 100 });
      if (type === "image.candidate.list") return Promise.resolve({ projectId: "p", candidates: [] });
      if (type === "image.project.edit") {
        if (host.conflictNext) {
          host.conflictNext = false; host.revision += 1;
          return Promise.reject(new ProtocolRequestError({ code: "RESOURCE_CHANGED_EXTERNALLY", message: "Revision conflict", recoverable: true, details: { imageReason: "revision_conflict" } }));
        }
        if (host.refuseNext) {
          const { message, imageReason } = host.refuseNext; host.refuseNext = undefined;
          return Promise.reject(new ProtocolRequestError({ code: "INVALID_PAYLOAD", message, recoverable: true, details: { imageReason } }));
        }
        if (payload.dryRun === true) return Promise.resolve({ projectId: "p", revision: host.revision + 1, sha256: "s", dryRun: true });
        host.revision += 1;
        return Promise.resolve({ projectId: "p", revision: host.revision, sha256: "s", dryRun: false });
      }
      if (type === "image.candidate.accept") { host.revision += 1; return Promise.resolve({ projectId: "p", revision: host.revision, sha256: "s" }); }
      if (type === "image.candidate.discard") return Promise.resolve({ projectId: "p", candidateId: payload.candidateId, status: "discarded" });
      if (type === "image.project.history") return Promise.resolve({ projectId: "p", revisions: [] });
      if (type === "image.project.checkText") return Promise.resolve({ projectId: payload.projectId, revision: host.revision, texts: host.unreadNext
        ? [{ objectId: "t", text: "¥199", read: "", passed: false, lowContrast: false }, { objectId: "u", text: "春日", read: "春日", passed: true, contrast: 1.4, lowContrast: true },
          { objectId: "v", text: "新品", read: "新品", passed: true, contrast: 9, lowContrast: false }] : [] });
      if (type === "image.project.addAsset") {
        if (payload.attachmentId === "full") return Promise.reject(new ProtocolRequestError({ code: "INVALID_PAYLOAD", message: "Invalid assets list", recoverable: true }));
        host.revision += 1; return Promise.resolve({ projectId: "p", revision: host.revision, sha256: "s", dryRun: false, assetId: "mask-1" });
      }
      if (type === "image.project.addFont") {
        if (payload.attachmentId === "bad") return Promise.reject(new ProtocolRequestError({ code: "INVALID_PAYLOAD", message: "Unsupported font file: not TrueType or OpenType", recoverable: true }));
        host.revision += 1;
        return Promise.resolve({ projectId: "p", revision: host.revision, sha256: "s", dryRun: false, fontId: "font-1", family: "Brand Sans" });
      }
      if (type === "image.brand.read") return Promise.resolve(host.brand);
      if (type === "image.project.useBrandFont") {
        if (payload.fontId === "stale") return Promise.reject(new Error("Revision conflict: expected 3, received 2"));
        host.revision += 1; return Promise.resolve({ projectId: "p", revision: host.revision, sha256: "s", dryRun: false }); }
      if (type === "image.project.addBrandLogo") {
        if (payload.logoId === "gone") return Promise.reject(new ProtocolRequestError({ code: "INVALID_PAYLOAD", message: "这个 Logo 已经不在品牌库里了。", recoverable: false }));
        host.revision += 1; host.objectIds = [...host.objectIds, "logo"];
        return Promise.resolve({ projectId: "p", revision: host.revision, sha256: "s", dryRun: false, objectId: "logo" });
      }
      if (type === "image.brand.edit" || type === "image.brand.addFont" || type === "image.brand.addLogo") {
        if (payload.baseRevision !== host.brand.revision) return Promise.reject(new Error("Brand conflict: expected 9, received 0"));
        host.brand = { ...host.brand, revision: host.brand.revision + 1 };
        return Promise.resolve(host.brand);
      }
      if (type === "image.template.create") return Promise.resolve({ projectId: "p-template", title: "海报 · 模板", slots: ["t"] });
      if (type === "image.template.instantiate") return Promise.resolve(payload.title === "放不下" ? { status: "refused", reason: "文字「x」在 100×100 里放不下" } : { status: "created", projectId: payload.projectId });
      if (type === "image.batch.create") return Promise.resolve({ projectId: "p", revision: host.revision, batchId: "b1", results: [
        { row: 1, status: "created", projectId: "p-b1-1", title: "海报 · ¥299", shrunkText: 0 }, { row: 2, status: "refused", reason: "文字「¥1999999」在 100×100 里放不下" }] });
      if (type === "image.batch.remove") return Promise.resolve({ batchId: payload.batchId, removed: ["p-b1-1"] });
      if (type === "image.project.derive") return Promise.resolve({ projectId: "p", revision: host.revision, results: (payload.presets as string[]).map((preset) => preset === "16x9"
        ? { preset, status: "refused", reason: "文字「春日」在 178×100 里放不下" }
        : { preset, status: "derived", projectId: `p-${preset}`, title: `海报 · ${preset}`, canvas: { width: 100, height: 100, background: "#fff" }, shrunkText: 0 }) });
      if (type === "image.project.deriveSize") return Promise.resolve({ projectId: "p", revision: host.revision, result: payload.name === "放不下"
        ? { status: "refused", reason: "文字「春日」在 300×10 里放不下" }
        : { status: "derived", projectId: `p-${String(payload.width)}x${String(payload.height)}`, title: `海报 · ${String(payload.name)}`, canvas: { width: payload.width, height: payload.height, background: "#fff" }, shrunkText: 0 } });
      return Promise.reject(new Error(`unexpected ${type}`));
    }
  }
};
/** Notices land in `notices`. */
export const mockNotifications = { publishNotification: (notice: { level: string; title: string; message: string }) => notices.push(notice) };
