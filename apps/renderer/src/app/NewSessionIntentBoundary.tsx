import { lazy, Suspense } from "react";
import type { ComponentProps } from "react";
import type { NewSessionIntentSurface as IntentSurface } from "./NewSessionIntentSurface.js";
import { LazySurfaceBoundary } from "./LazySurfaceBoundary.js";

const NewSessionIntentSurface = lazy(() => import("./NewSessionIntentSurface.js").then(module => ({
  default: module.NewSessionIntentSurface
})));

export function NewSessionIntentBoundary({ pending, ...props }: ComponentProps<typeof IntentSurface> & { pending: boolean }) {
  if (pending) return <IntentLoading />;
  return <LazySurfaceBoundary
    description="草稿仍保留在当前工作区；可以重新加载界面后继续。"
    kind="workspace"
    surface="new-session-intent"
    title="新会话界面未能加载"
  >
    <Suspense fallback={<IntentLoading />}>
      <NewSessionIntentSurface {...props} />
    </Suspense>
  </LazySurfaceBoundary>;
}

function IntentLoading() {
  return <section className="conversation-region" aria-busy="true">
    <div className="transcript-loading" role="status">正在加载对话界面</div>
  </section>;
}
