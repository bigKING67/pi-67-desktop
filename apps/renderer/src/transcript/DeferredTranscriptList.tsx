import { lazy, Suspense, type RefObject } from "react";
import type { VirtuosoHandle, VirtuosoProps } from "react-virtuoso";
import { preloadDeferredTranscriptRows } from "./DeferredTranscriptRows.js";
import type { TranscriptContext } from "./transcript-context.js";
import type { TranscriptRow } from "./transcript-rows.js";
import styles from "./Transcript.module.css";

type DeferredTranscriptListProps = VirtuosoProps<TranscriptRow, TranscriptContext> & {
  virtuosoRef: RefObject<VirtuosoHandle | null>;
};

const TranscriptList = lazy(() => Promise.all([
  import("react-virtuoso"),
  preloadDeferredTranscriptRows()
]).then(([{ Virtuoso }]) => ({
  default: ({ virtuosoRef, ...props }: DeferredTranscriptListProps) => (
    <Virtuoso<TranscriptRow, TranscriptContext> {...props} ref={virtuosoRef} />
  )
})));

export function DeferredTranscriptList(props: DeferredTranscriptListProps) {
  return (
    <Suspense fallback={<TranscriptListLoading />}>
      <TranscriptList {...props} />
    </Suspense>
  );
}

function TranscriptListLoading() {
  return (
    <div aria-busy="true" aria-label="正在加载会话记录" className={styles.listLoading} role="status">
      <span className="loading-line" />
    </div>
  );
}
