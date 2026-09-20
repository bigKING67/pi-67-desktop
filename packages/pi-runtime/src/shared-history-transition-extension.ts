import type { ExtensionContext, InlineExtension } from "@earendil-works/pi-coding-agent";
import { sharedHistoryNeedsAuthorization } from "./session-memory-provenance.js";

/** Pi session-before events require explicit cancellation; handler exceptions are swallowed. */
export function createSharedHistoryTransitionExtension(): InlineExtension {
  return {
    name: "pi67-shared-history-transitions",
    hidden: true,
    factory(pi) {
      const guard = (_event: unknown, context: ExtensionContext) => {
        try {
          if (!sharedHistoryNeedsAuthorization(context.sessionManager)) return;
        } catch {
          // An unreadable provenance boundary must cancel, not escape into Pi's error handler.
        }
        return { cancel: true };
      };
      pi.on("session_before_compact", guard);
      pi.on("session_before_fork", guard);
      pi.on("session_before_tree", guard);
    }
  };
}
