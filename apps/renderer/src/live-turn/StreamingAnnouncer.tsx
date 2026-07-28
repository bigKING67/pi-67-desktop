import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveTurnStore } from "./live-turn-store.js";
import { StreamingAnnouncerScheduler } from "./streaming-announcer.js";

export function StreamingAnnouncer() {
  const authority = useLiveTurnStore((state) => state.authority);
  const textChunks = useLiveTurnStore((state) => state.textChunks);
  const text = useMemo(() => textChunks.join(""), [textChunks]);
  const [announcement, setAnnouncement] = useState("");
  const scheduler = useRef<StreamingAnnouncerScheduler | undefined>(undefined);
  scheduler.current ??= new StreamingAnnouncerScheduler({ announce: setAnnouncement });

  useEffect(() => {
    scheduler.current?.update(text, authority);
  }, [authority, text]);

  useEffect(() => () => scheduler.current?.dispose(), []);

  return (
    <div
      aria-atomic="true"
      aria-live="polite"
      className="sr-only"
      data-streaming-announcer="true"
      role="status"
    >
      {announcement}
    </div>
  );
}
