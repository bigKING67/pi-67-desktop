import { lazy, Suspense, type ComponentProps } from "react";
import styles from "./Transcript.module.css";

type MessageCardComponent = typeof import("./MessageCard.js").MessageCard;
type TranscriptProcessGroupComponent = typeof import("./TranscriptProcessGroup.js").TranscriptProcessGroup;

let LoadedMessageCard: MessageCardComponent | undefined;
let LoadedTranscriptProcessGroup: TranscriptProcessGroupComponent | undefined;
let transcriptRowsReady: Promise<void> | undefined;

const LazyMessageCard = lazy(() => loadDeferredTranscriptRows().then(() => ({
  default: LoadedMessageCard!
})));
const LazyTranscriptProcessGroup = lazy(() => loadDeferredTranscriptRows().then(() => ({
  default: LoadedTranscriptProcessGroup!
})));

export function preloadDeferredTranscriptRows(): Promise<void> {
  return loadDeferredTranscriptRows();
}

export function DeferredMessageCard(props: ComponentProps<typeof LazyMessageCard>) {
  if (LoadedMessageCard) return <LoadedMessageCard {...props} />;
  return (
    <Suspense fallback={<TranscriptRowLoading />}>
      <LazyMessageCard {...props} />
    </Suspense>
  );
}

export function DeferredTranscriptProcessGroup(props: ComponentProps<typeof LazyTranscriptProcessGroup>) {
  if (LoadedTranscriptProcessGroup) return <LoadedTranscriptProcessGroup {...props} />;
  return (
    <Suspense fallback={<TranscriptRowLoading />}>
      <LazyTranscriptProcessGroup {...props} />
    </Suspense>
  );
}

function loadDeferredTranscriptRows(): Promise<void> {
  transcriptRowsReady ??= Promise.all([
    import("./MessageCard.js"),
    import("./TranscriptProcessGroup.js")
  ]).then(([messageCardModule, processGroupModule]) => {
    LoadedMessageCard = messageCardModule.MessageCard;
    LoadedTranscriptProcessGroup = processGroupModule.TranscriptProcessGroup;
  });
  return transcriptRowsReady;
}

function TranscriptRowLoading() {
  return (
    <div aria-busy="true" aria-label="正在加载消息" className={styles.rowLoading} role="status">
      <span className="loading-line" />
    </div>
  );
}
