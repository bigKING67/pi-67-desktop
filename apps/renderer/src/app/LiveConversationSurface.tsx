import { lazy, Suspense } from "react";
import { Composer } from "../composer/Composer.js";
import { StreamingAnnouncer } from "../live-turn/StreamingAnnouncer.js";
import { Transcript } from "../transcript/Transcript.js";

const TrustBanner = lazy(() => import("../workspace/TrustBanner.js").then((module) => ({
  default: module.TrustBanner
})));

export function LiveConversationSurface({ showTrustBanner }: { showTrustBanner: boolean }) {
  return (
    <section className="conversation-region" aria-label="Pi conversation">
      {showTrustBanner ? (
        <Suspense fallback={null}><TrustBanner /></Suspense>
      ) : null}
      <StreamingAnnouncer />
      <Transcript />
      <Composer />
    </section>
  );
}
