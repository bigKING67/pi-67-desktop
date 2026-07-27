// Package-internal build entry for real-file performance evidence. It is not a public package export.
export {
  SessionJsonlTailError,
  createSessionJsonlTailCursor,
  drainSessionJsonlTail,
  type SessionJsonlChangeReason,
  type SessionJsonlTailCursor,
  type SessionJsonlTailDrain,
  type SessionJsonlTailLimits
} from "./session-jsonl-tail.js";
export {
  SessionJsonlWatcher,
  type SessionJsonlExternalChange,
  type SessionJsonlWatcherBinding,
  type SessionJsonlWatcherOptions
} from "./session-jsonl-watcher.js";
