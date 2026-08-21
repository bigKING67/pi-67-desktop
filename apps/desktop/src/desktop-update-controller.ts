import type { UnsignedUpdateDownloadProgress, VerifiedUnsignedUpdateDownload } from "./unsigned-update-download.js";
import { downloadUnsignedUpdate } from "./unsigned-update-download.js";
import { installUnsignedUpdate } from "./unsigned-update-installer.js";
import {
  checkForUnsignedPreviewUpdate,
  UNSIGNED_PREVIEW_CHANNEL,
  type CheckedUnsignedPreviewUpdate,
  type SupportedUpdatePlatform,
  type TrustedUpdateArtifact
} from "./unsigned-preview-update.js";

export const AUTOMATIC_UPDATE_STARTUP_DELAY_MS = 10_000;
export const AUTOMATIC_UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1_000;

interface UpdateMetadata {
  readonly channel: typeof UNSIGNED_PREVIEW_CHANNEL;
  readonly currentVersion: string;
  readonly automaticChecks: boolean;
  readonly checkedAt?: string;
}

type DesktopUpdateStateCore =
  | { readonly phase: "checking" | "current" | "idle" }
  | {
      readonly phase: "available" | "installing";
      readonly version: string;
      readonly artifactName: string;
      readonly artifactBytes: number;
    }
  | {
      readonly phase: "downloading";
      readonly version: string;
      readonly artifactName: string;
      readonly artifactBytes: number;
      readonly transferred: number;
      readonly percent: number;
  }
  | { readonly phase: "disabled" | "error"; readonly detail: string };

export type DesktopUpdateState = UpdateMetadata & DesktopUpdateStateCore;

interface DesktopUpdateControllerOptions {
  currentVersion: string;
  packaged: boolean;
  platform: SupportedUpdatePlatform;
  updateDirectory: string;
  executablePath: string;
  processId: number;
  fetcher: (input: string, init: RequestInit) => Promise<Response>;
  publish: (state: DesktopUpdateState) => void;
  quit: () => void;
  now?: () => number;
  check?: (options: {
    currentVersion: string;
    platform: SupportedUpdatePlatform;
    fetcher: (input: string, init: RequestInit) => Promise<Response>;
  }) => Promise<CheckedUnsignedPreviewUpdate>;
  download?: (options: {
    artifact: TrustedUpdateArtifact;
    directory: string;
    fetcher: (input: string, init: RequestInit) => Promise<Response>;
    signal: AbortSignal;
    onProgress: (progress: UnsignedUpdateDownloadProgress) => void;
  }) => Promise<VerifiedUnsignedUpdateDownload>;
  install?: typeof installUnsignedUpdate;
  sanitizeError?: (error: unknown) => string;
}

interface AvailableUpdate {
  readonly version: string;
  readonly artifact: TrustedUpdateArtifact;
}

export class DesktopUpdateController {
  readonly #options: DesktopUpdateControllerOptions;
  readonly #now: () => number;
  readonly #check: NonNullable<DesktopUpdateControllerOptions["check"]>;
  readonly #download: NonNullable<DesktopUpdateControllerOptions["download"]>;
  readonly #install: NonNullable<DesktopUpdateControllerOptions["install"]>;
  readonly #sanitizeError: NonNullable<DesktopUpdateControllerOptions["sanitizeError"]>;
  #state: DesktopUpdateState;
  #available: AvailableUpdate | undefined;
  #pendingCheck: Promise<DesktopUpdateState> | undefined;
  #pendingUpdate: Promise<DesktopUpdateState> | undefined;
  #downloadAbort: AbortController | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #lastAttemptAt: number | undefined;
  #started = false;

  constructor(options: DesktopUpdateControllerOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#check = options.check ?? checkForUnsignedPreviewUpdate;
    this.#download = options.download ?? downloadUnsignedUpdate;
    this.#install = options.install ?? installUnsignedUpdate;
    this.#sanitizeError = options.sanitizeError ?? ((error) => (
      error instanceof Error ? error.message : String(error)
    ));
    this.#state = options.packaged
      ? this.#withMetadata({ phase: "idle" })
      : this.#withMetadata({ phase: "disabled", detail: "Development build" });
  }

  getState(): DesktopUpdateState {
    return this.#state;
  }

  startAutomaticChecks(): void {
    if (!this.#options.packaged || this.#started) return;
    this.#started = true;
    this.#schedule(AUTOMATIC_UPDATE_STARTUP_DELAY_MS);
  }

  checkNow(): Promise<DesktopUpdateState> {
    return this.#runCheck();
  }

  startUpdate(): Promise<DesktopUpdateState> {
    if (this.#pendingUpdate) return this.#pendingUpdate;
    if (
      !this.#options.packaged
      || !this.#available
      || this.#pendingCheck
      || this.#state.phase !== "available"
    ) {
      return Promise.resolve(this.#state);
    }
    const available = this.#available;
    const abort = new AbortController();
    this.#downloadAbort = abort;
    this.#setState(this.#availableState("downloading", available, {
      transferred: 0,
      percent: 0
    }));
    const pending = this.#download({
      artifact: available.artifact,
      directory: this.#options.updateDirectory,
      fetcher: this.#options.fetcher,
      signal: abort.signal,
      onProgress: (progress) => {
        if (abort.signal.aborted || this.#downloadAbort !== abort) return;
        this.#setState(this.#availableState("downloading", available, {
          transferred: progress.transferred,
          percent: progress.percent
        }));
      }
    }).then(async (download) => {
      if (abort.signal.aborted) throw abort.signal.reason;
      this.#setState(this.#availableState("installing", available));
      await this.#install({
        platform: this.#options.platform,
        version: available.version,
        downloadPath: download.path,
        executablePath: this.#options.executablePath,
        updateRoot: this.#options.updateDirectory,
        processId: this.#options.processId,
        quit: this.#options.quit
      });
      return this.#state;
    }).catch((error: unknown) => {
      if (abort.signal.aborted || isAbortError(error)) {
        this.#setState(this.#availableState("available", available));
        return this.#state;
      }
      this.#setState(this.#withMetadata({
        phase: "error",
        detail: this.#boundedError(error)
      }, this.#lastAttemptAt));
      return this.#state;
    }).finally(() => {
      if (this.#pendingUpdate === pending) this.#pendingUpdate = undefined;
      if (this.#downloadAbort === abort) this.#downloadAbort = undefined;
    });
    this.#pendingUpdate = pending;
    return pending;
  }

  async cancelUpdate(): Promise<DesktopUpdateState> {
    if (this.#state.phase === "downloading") {
      this.#downloadAbort?.abort(new DOMException("Update download cancelled.", "AbortError"));
      return this.#pendingUpdate ?? this.#state;
    }
    return this.#state;
  }

  checkIfDue(): void {
    if (!this.#options.packaged || !this.#started || this.#pendingUpdate) return;
    const elapsed = this.#lastAttemptAt === undefined
      ? AUTOMATIC_UPDATE_INTERVAL_MS
      : this.#now() - this.#lastAttemptAt;
    if (elapsed >= AUTOMATIC_UPDATE_INTERVAL_MS) {
      void this.#runAutomaticCheck();
      return;
    }
    this.#schedule(AUTOMATIC_UPDATE_INTERVAL_MS - Math.max(0, elapsed));
  }

  dispose(): void {
    this.#started = false;
    this.#downloadAbort?.abort(new DOMException("Update controller disposed.", "AbortError"));
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  async #runAutomaticCheck(): Promise<void> {
    await this.#runCheck();
    if (this.#started) this.#schedule(AUTOMATIC_UPDATE_INTERVAL_MS);
  }

  #runCheck(): Promise<DesktopUpdateState> {
    if (!this.#options.packaged || this.#pendingUpdate) return Promise.resolve(this.#state);
    if (this.#pendingCheck) return this.#pendingCheck;
    const attemptedAt = this.#now();
    this.#lastAttemptAt = attemptedAt;
    this.#available = undefined;
    this.#setState(this.#withMetadata({ phase: "checking" }, attemptedAt));
    let checkResult: Promise<CheckedUnsignedPreviewUpdate>;
    try {
      checkResult = this.#check({
        currentVersion: this.#options.currentVersion,
        platform: this.#options.platform,
        fetcher: this.#options.fetcher
      });
    } catch (error) {
      checkResult = Promise.reject(error);
    }
    const checkedPromise = checkResult.then((checked) => {
      if (checked.state.phase === "available") {
        if (!checked.artifact) throw new Error("Pi-67 update check omitted its verified artifact.");
        this.#available = { version: checked.state.version, artifact: checked.artifact };
      } else {
        this.#available = undefined;
      }
      return this.#withMetadata(checked.state, attemptedAt);
    }).catch((error: unknown) => {
      this.#available = undefined;
      return this.#withMetadata({ phase: "error", detail: this.#boundedError(error) }, attemptedAt);
    });
    const pending = checkedPromise.then((state) => {
      this.#setState(state);
      return state;
    }).finally(() => {
      if (this.#pendingCheck === pending) this.#pendingCheck = undefined;
    });
    this.#pendingCheck = pending;
    return pending;
  }

  #availableState(
    phase: "available" | "downloading" | "installing",
    available: AvailableUpdate,
    progress?: { transferred: number; percent: number }
  ): DesktopUpdateState {
    const artifact = available.artifact;
    const artifactState = {
      version: available.version,
      artifactName: artifact.name,
      artifactBytes: artifact.bytes
    };
    if (phase === "downloading") {
      return this.#withMetadata({
        phase,
        ...artifactState,
        transferred: progress?.transferred ?? 0,
        percent: progress?.percent ?? 0
      }, this.#lastAttemptAt);
    }
    return this.#withMetadata({ phase, ...artifactState }, this.#lastAttemptAt);
  }

  #setState(state: DesktopUpdateState): void {
    this.#state = state;
    this.#options.publish(state);
  }

  #withMetadata(
    result: DesktopUpdateStateCore,
    checkedAt?: number
  ): DesktopUpdateState {
    return {
      ...result,
      channel: UNSIGNED_PREVIEW_CHANNEL,
      currentVersion: this.#options.currentVersion,
      automaticChecks: this.#options.packaged,
      ...(checkedAt === undefined ? {} : { checkedAt: new Date(checkedAt).toISOString() })
    } as DesktopUpdateState;
  }

  #boundedError(error: unknown): string {
    return this.#sanitizeError(error).slice(0, 500);
  }

  #schedule(delay: number): void {
    if (!this.#started) return;
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.checkIfDue();
    }, delay);
    this.#timer.unref?.();
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
