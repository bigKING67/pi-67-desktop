/**
 * Pi OpenViking Extension
 *
 * Integrates pi with an OpenViking context database for persistent,
 * cross-session memory. Syncs conversation turns to OV, recalls relevant
 * context for every current prompt, exposes Tools for bounded on-demand
 * retrieval, and commits sessions for long-term memory extraction.
 *
 * Design informed by: OpenClaw (synchronous recall), Claude Code plugin
 * (most mature, production-hardened), Hermes (anti-pattern: stale prefetch).
 */
import type { ExtensionAPI } from "@pi67/pi-runtime/pi-sdk-types";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { bindWorkspacePeer, loadConfigFromModuleUrl, type OVConfig } from "./config.js";
import { OVClient } from "./client.js";
import { RecallManager } from "./recall.js";
import { SyncManager } from "./sync.js";
import { buildProfileBlock } from "./shared/profile-inject.mjs";
import { guardVikingUriToolCall } from "./lib/uri-guard-adapter.mjs";
import { OPENVIKING_MODEL_RECALL_POLICY, registerTools } from "./tools.js";
import { createTakeoverManager } from "./takeover.js";
import { emitContextDiagnostic, hashDiagnosticValue } from "./diagnostics.js";
import { detectMemoryOwnerConflict } from "./memory-owner-policy.js";
import { createRuntimePrivacyGuard } from "./runtime-privacy.js";

export default async function (pi: ExtensionAPI) {
  // --- Load config ---
  const config = loadConfigFromModuleUrl(import.meta.url);
  if (!config.enabled) return;

  const agentDir = process.env.PI_CODING_AGENT_DIR || process.env.PI_AGENT_DIR || "";
  const conflict = agentDir ? detectMemoryOwnerConflict(agentDir) : null;
  if (conflict) {
    emitContextDiagnostic({
      kind: "context.memoryDisabled",
      privacyMode: config.privacyMode,
      state: "disabled",
      reason: `${conflict.reason}:${conflict.conflicts.join(",")}`,
    });
    pi.registerCommand("viking", {
      description: "OpenViking status (this Extension self-disabled after an owner conflict).",
      handler: async (_args, ctx) => {
        ctx.ui.notify(
          `OpenViking self-disabled: conflicting owners ${conflict.conflicts.join(", ")}. Pi remains available, but this Extension cannot stop an already loaded competing Memory Extension; use the Desktop preload gate or fix the owner configuration before a new Session.`,
          "warning",
        );
      },
    });
    return;
  }
  emitContextDiagnostic({
    kind: "context.ownerLocked",
    privacyMode: config.privacyMode,
    state: "locked",
  });

  const client = new OVClient(config);
  client.onConnectionChange((connected) => {
    emitContextDiagnostic({
      kind: "context.healthChanged",
      privacyMode: config.privacyMode,
      state: connected ? "healthy" : "degraded",
    });
  });
  const sync = new SyncManager(client, config, {
    persistEntry: (customType, data) => pi.appendEntry(customType, data),
  });
  const recall = new RecallManager(client, config, () => sync.sessionId);
  const debugLog = (message: string) => {
    const file = process.env.OV_DEBUG_LOG;
    if (!file) return;
    try {
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, `${new Date().toISOString()} ${message}\n`);
    } catch {
      // Best effort; logging must never affect pi.
    }
  };
  const takeover = createTakeoverManager({ pi, client, sync, config, log: debugLog });

  // Session state
  let bypassed = false;
  let profileBlock = "";
  let archiveOverview = "";
  let toolsRegistered = false;
  let compacted = false;
  let started = false;
  let startPromise: Promise<void> | null = null;
  const refreshRuntimePrivacy = createRuntimePrivacyGuard(config, import.meta.url, () => {
    recall.invalidate();
    profileBlock = "";
    archiveOverview = "";
  });

  // ================================================================
  // ================================================================

  const start = async (ctx: any): Promise<void> => {
    const sessionCwd = typeof ctx?.sessionManager?.getCwd === "function" ? ctx.sessionManager.getCwd() : "";
    // Rebind reused Extension instances before lifecycle fast paths.
    bindWorkspacePeer(config, sessionCwd);
    client.setPeerId(config.peerId);
    if (started) return;
    if (startPromise) return startPromise;

    startPromise = (async () => {
      if (!refreshRuntimePrivacy()) {
        started = true;
        return;
      }
      // Bypass check
      const cwd = sessionCwd;
      for (const pattern of config.bypassPatterns) {
        if (matchBypass(cwd, pattern)) {
          bypassed = true;
          started = true;
          return;
        }
      }

      // Register once even if health is temporarily degraded. viking_search and
      // viking_read perform a fresh health probe, so a recovered server becomes
      // usable without restarting Pi.
      if (!toolsRegistered) {
        registerTools(pi, client, sync, refreshRuntimePrivacy);
        toolsRegistered = true;
      }

      // Health check
      if (!await client.ensureConnected(true)) {
        if (config.logLevel === "info") {
          ctx.ui.notify("OpenViking: server not reachable", "warning");
        }
        return;
      }

      // Ensure OV session
      const piSessionId = ctx.sessionManager.getSessionId();
      const branch = typeof ctx.sessionManager.getBranch === "function"
        ? ctx.sessionManager.getBranch()
        : [];
      if (config.takeoverEnabled) takeover.restore(branch);
      sync.restore(branch, piSessionId, config.takeoverEnabled ? takeover.state.syncedEntryCount : 0);
      const ok = await sync.ensureSession(piSessionId);
      if (!ok) {
        emitContextDiagnostic({ kind: "context.healthChanged", privacyMode: config.privacyMode,
          state: "degraded", reason: "session-create-failed" });
        if (config.logLevel === "info") ctx.ui.notify(
          "OpenViking: Session 暂不可用，Pi 已继续运行", "warning",
        );
        return;
      }
      await sync.replayPending();

      // Profile injection
      profileBlock = await buildSessionProfileBlock(client, config);

      if (!config.takeoverEnabled && sync.sessionId) {
        // Resume rehydration — fetch archive overview if session was previously committed.
        archiveOverview = await fetchArchiveOverview(client, sync.sessionId, config);
      }

      updateStatus(ctx, client.connected, 0, sync.sessionId, config, takeover.state);

      started = true;
      if (config.logLevel === "info") {
        ctx.ui.notify(`OpenViking connected (${piSessionId.slice(0, 8)}...)`, "info");
      }
    })().finally(() => {
      startPromise = null;
    });

    return startPromise;
  };

  // --- session_start ---
  pi.on("session_start", async (event, ctx) => {
    await start(ctx);
  });

  // --- before_agent_start ---
  pi.on("before_agent_start", async (event, ctx) => {
    if (!refreshRuntimePrivacy()) return;
    // session_start doesn't fire for pi -c continuations.
    await start(ctx);

    if (!refreshRuntimePrivacy() || bypassed || !await client.ensureConnected()) return;

    const branch = typeof ctx.sessionManager.getBranch === "function"
      ? ctx.sessionManager.getBranch()
      : [];
    if (await sync.alignBranch(branch)) {
      archiveOverview = "";
      compacted = false;
    }

    // Follow the official OpenViking lifecycle: every current prompt receives
    // synchronous Recall in the context hook, including in-Session task shifts.
    recall.queueSearch(event.prompt);

    // Only static Tool availability belongs in the System Prompt. Profile,
    // archive, Recall, and Experience content comes from the Memory trust
    // domain and is injected later as untrusted user-level context.
    const additions = [
      "OpenViking tools: viking_search, viking_read, viking_browse, viking_remember, viking_forget, viking_archive_expand.",
      OPENVIKING_MODEL_RECALL_POLICY,
    ].join("\n");
    return {
      systemPrompt: event.systemPrompt + "\n\n" + additions,
    };
  });

  // --- context ---
  pi.on("context", async (event, _ctx) => {
    if (!refreshRuntimePrivacy()) {
      return { messages: recall.injectContext(event.messages as any, []) };
    }
    if (!client.connected || bypassed) return;

    const recallWasPending = recall.hasPendingSearch();
    const currentQueryHash = recall.pendingQueryHash();
    const recallStartedAt = recallWasPending ? Date.now() : 0;
    if (recallWasPending) {
      emitContextDiagnostic({
        kind: "context.recallStarted",
        privacyMode: config.privacyMode,
        state: "running",
      });
    }
    const recallResult = await recall.searchPending();
    if (!refreshRuntimePrivacy()) {
      return { messages: recall.injectContext(event.messages as any, []) };
    }
    if (recallWasPending) {
      emitContextDiagnostic({
        kind: "context.recallCompleted",
        privacyMode: config.privacyMode,
        state: recallResult.state === "ready" ? "prompt-ready" : "empty-or-degraded",
        route: "prompt-context",
        durationMs: Date.now() - recallStartedAt,
        count: recallResult.block ? 1 : 0,
        selectedCount: recallResult.block ? 1 : 0,
        tokenBudget: config.recallTokenBudget,
        usedTokens: recallResult.block ? Math.ceil(recallResult.block.length / 4) : 0,
        detailMode: config.recallPreferAbstract ? "abstract-first" : "bounded-content",
        ...(currentQueryHash === undefined ? {} : { queryHash: currentQueryHash }),
        scopeHash: hashDiagnosticValue(config.peerId),
        ...(sync.piSessionId === null ? {} : { sessionIdHash: hashDiagnosticValue(sync.piSessionId) }),
      });
    }

    const afterTakeover = config.takeoverEnabled
      ? takeover.transformContext(event.messages as any)
      : event.messages;
    const supplementalMemory = [
      profileBlock,
      !config.takeoverEnabled && archiveOverview && (compacted || archiveOverview.trim())
        ? archiveOverview
        : "",
    ];
    const messages = recall.injectContext(afterTakeover, supplementalMemory);
    return { messages };
  });

  // --- tool_call ---
  pi.on("tool_call", async (event, _ctx) => {
    const decision = guardVikingUriToolCall(event);
    if (!decision) return;
    return decision;
  });

  // --- turn_end ---
  pi.on("turn_end", async (event, ctx) => {
    if (!refreshRuntimePrivacy() || bypassed || !config.syncTurns) return;
    if (!await client.ensureConnected()) return;

    const branch = ctx.sessionManager.getBranch();
    const result = await sync.syncBranch(branch);
    emitContextDiagnostic({
      kind: "context.captureCompleted",
      privacyMode: config.privacyMode,
      state: result.allDelivered ? "delivered" : "queued",
      count: result.added,
    });
    debugLog(`turn_end: synced ${result.added} entries, ~${result.tokens} tokens`);
    await takeover.onTurnSynced(result.tokens);
    updateStatus(ctx, client.connected, result.added, sync.sessionId, config, takeover.state);
  });

  // --- session_before_compact ---
  pi.on("session_before_compact", async (event, _ctx) => {
    if (!refreshRuntimePrivacy() || !client.connected || bypassed) return;

    if (config.takeoverEnabled) {
      const prep = (event as any)?.preparation ?? {};
      return await takeover.handleBeforeCompact({
        firstKeptEntryId: prep.firstKeptEntryId,
        tokensBefore: prep.tokensBefore ?? 0,
      });
    }

    const archiveId = await sync.commit();
    compacted = true;

    // Cache archive overview for rehydration after compaction
    if (archiveId && sync.sessionId) {
      archiveOverview = await fetchArchiveOverview(
        client, sync.sessionId, config,
      );
    }
    // Return nothing → pi proceeds with default compaction
  });

  // --- session_shutdown ---
  pi.on("session_shutdown", async (_event, _ctx) => {
    if (!refreshRuntimePrivacy() || !client.connected || bypassed) return;

    await sync.shutdown();
    if (config.takeoverEnabled) {
      await takeover.shutdown();
    } else {
      await sync.commit();
    }
    recall.invalidate();
  });

  // --- agent_end ---
  // Match upstream lifecycle ownership: the current-prompt snapshot exists only
  // for one Pi agent run and cannot survive into an idle Session.
  pi.on("agent_end", async (_event, _ctx) => {
    recall.invalidate();
  });

  // ================================================================
  // Commands
  // ================================================================

  pi.registerCommand("viking", {
    description: "OpenViking status and commit operations. Current prompts recall automatically; Tools provide bounded deep retrieval.",
    handler: async (args, ctx) => {
      if (!refreshRuntimePrivacy()) {
        ctx.ui.notify("OpenViking: memory is disabled for this Session", "warning");
        return;
      }
      if (!await client.ensureConnected()) {
        ctx.ui.notify("OpenViking: not connected", "warning");
        return;
      }

      if (args?.trim() === "commit") {
        await sync.shutdown();
        const commitResult = config.takeoverEnabled ? null : await sync.commit();
        const ok = config.takeoverEnabled
          ? await takeover.commitAndAdvance()
          : commitResult !== null;
        if (ok) {
          ctx.ui.notify(
            "OpenViking: committed successfully" +
              (commitResult?.trace_id ? ` (trace_id=${commitResult.trace_id})` : ""),
            "info",
          );
        } else {
          ctx.ui.notify("OpenViking: commit failed", "error");
        }
        return;
      }

      // Status
      const sid = sync.sessionId ?? "none";
      const t = takeover.state;
      const takeoverInfo = config.takeoverEnabled
        ? ` | takeover: ${t.coveredUserTurns}/${t.lastSeenUserTurns} turns archived, ~${t.pendingTokens} tokens pending`
        : "";
      ctx.ui.notify(
        `OpenViking: ${client.connected ? "connected" : "disconnected"} | session: ${sid.slice(0, 12)}... | current-prompt recall: ${recall.state} | deep retrieval: Pi Tool${takeoverInfo}`,
        "info",
      );
    },
  });
}

// ================================================================
// Helper Functions
// ================================================================

/** Simple bypass pattern matching (prefix and glob). */
function matchBypass(cwd: string, pattern: string): boolean {
  if (pattern.startsWith("*")) {
    return cwd.endsWith(pattern.slice(1));
  }
  if (pattern.endsWith("*")) {
    return cwd.startsWith(pattern.slice(0, -1));
  }
  return cwd === pattern || cwd.startsWith(pattern + "/");
}

/** Build the inner Session profile block for user-level memory injection. */
async function buildSessionProfileBlock(
  client: OVClient, config: OVConfig,
): Promise<string> {
  try {
    const profile = await buildProfileBlock(
      (path: string, init?: any, _options?: any) => client.fetchJSON(path, init, 10000),
      config.profileTokenBudget,
      config.peerId,
    );
    if (!profile?.block) return "";
    return [
      '<session-profile source="openviking-session-start">',
      profile.block,
      "</session-profile>",
    ].join("\n");
  } catch {
    return "";
  }
}

/** Fetch archive overview for rehydration using the session context API. */
async function fetchArchiveOverview(
  client: OVClient, sessionId: string, config: OVConfig,
): Promise<string> {
  try {
    const ctx = await client.getSessionContext(sessionId, config.resumeContextBudget);
    if (!ctx || !ctx.latest_archive_overview) return "";

    return [
      '<session-archive source="openviking-session-archive">',
      ctx.latest_archive_overview,
      "</session-archive>",
    ].join("\n");
  } catch {
    return "";
  }
}

function updateStatus(
  ctx: any,
  connected: boolean,
  added: number,
  sessionId: string | null,
  config: OVConfig,
  takeoverState?: { pendingTokens?: number; coveredUserTurns?: number },
): void {
  const setter = ctx?.ui?.setStatus;
  if (typeof setter !== "function") return;
  const threshold = config.takeoverEnabled
    ? config.takeoverTokenThreshold
    : config.commitTokenThreshold;
  const pending = config.takeoverEnabled && takeoverState
    ? ` · ctx ${takeoverState.coveredUserTurns ?? 0} · ~${takeoverState.pendingTokens ?? 0}/${threshold}`
    : ` · ✎ ${threshold}`;
  const status = `${connected ? "OV ✓" : "OV ✗"} · ↩${added}${pending} · ${sessionId ? sessionId.slice(0, 12) : "none"}`;
  try {
    setter(status);
  } catch {
    // Best effort; pi API shape may vary across fast-moving versions.
  }
}
