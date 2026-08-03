import {
  checkForUnsignedPreviewUpdate,
  type ManualUpdateState,
  type UnsignedPreviewUpdateResult
} from "./manual-update.js";

export const AUTOMATIC_UPDATE_STARTUP_DELAY_MS = 10_000;
export const AUTOMATIC_UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1_000;

interface ManualUpdateControllerOptions {
  currentVersion: string;
  packaged: boolean;
  fetcher: (input: string, init: RequestInit) => Promise<Response>;
  publish: (state: ManualUpdateState) => void;
  now?: () => number;
  check?: (options: {
    currentVersion: string;
    fetcher: (input: string, init: RequestInit) => Promise<Response>;
  }) => Promise<UnsignedPreviewUpdateResult>;
  sanitizeError?: (error: unknown) => string;
}

export class ManualUpdateController {
  readonly #currentVersion: string;
  readonly #packaged: boolean;
  readonly #fetcher: ManualUpdateControllerOptions["fetcher"];
  readonly #publish: ManualUpdateControllerOptions["publish"];
  readonly #now: () => number;
  readonly #check: NonNullable<ManualUpdateControllerOptions["check"]>;
  readonly #sanitizeError: NonNullable<ManualUpdateControllerOptions["sanitizeError"]>;
  #state: ManualUpdateState;
  #pending: Promise<ManualUpdateState> | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #lastAttemptAt: number | undefined;
  #started = false;

  constructor(options: ManualUpdateControllerOptions) {
    this.#currentVersion = options.currentVersion;
    this.#packaged = options.packaged;
    this.#fetcher = options.fetcher;
    this.#publish = options.publish;
    this.#now = options.now ?? Date.now;
    this.#check = options.check ?? checkForUnsignedPreviewUpdate;
    this.#sanitizeError = options.sanitizeError ?? ((error) => (
      error instanceof Error ? error.message : String(error)
    ));
    this.#state = options.packaged
      ? this.#withMetadata({ phase: "idle", channel: "unsigned-preview", currentVersion: options.currentVersion })
      : this.#withMetadata({
          phase: "disabled",
          channel: "unsigned-preview",
          currentVersion: options.currentVersion,
          detail: "Development build"
        });
  }

  getState(): ManualUpdateState {
    return this.#state;
  }

  startAutomaticChecks(): void {
    if (!this.#packaged || this.#started) return;
    this.#started = true;
    this.#schedule(AUTOMATIC_UPDATE_STARTUP_DELAY_MS);
  }

  checkNow(): Promise<ManualUpdateState> {
    return this.#runCheck();
  }

  checkIfDue(): void {
    if (!this.#packaged || !this.#started) return;
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
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  async #runAutomaticCheck(): Promise<void> {
    await this.#runCheck();
    if (this.#started) this.#schedule(AUTOMATIC_UPDATE_INTERVAL_MS);
  }

  #runCheck(): Promise<ManualUpdateState> {
    if (!this.#packaged) return Promise.resolve(this.#state);
    if (this.#pending) return this.#pending;
    const attemptedAt = this.#now();
    this.#lastAttemptAt = attemptedAt;
    const pending = this.#check({
      currentVersion: this.#currentVersion,
      fetcher: this.#fetcher
    }).then((result) => this.#withMetadata(result, attemptedAt)).catch((error: unknown) => this.#withMetadata({
      phase: "error",
      channel: "unsigned-preview",
      currentVersion: this.#currentVersion,
      detail: this.#sanitizeError(error).slice(0, 500)
    }, attemptedAt));
    this.#pending = pending;
    void pending.then((state) => {
      this.#state = state;
      this.#publish(state);
    }).finally(() => {
      if (this.#pending === pending) this.#pending = undefined;
    });
    return pending;
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

  #withMetadata(result: UnsignedPreviewUpdateResult, checkedAt?: number): ManualUpdateState {
    return {
      ...result,
      automaticChecks: this.#packaged,
      ...(checkedAt === undefined ? {} : { checkedAt: new Date(checkedAt).toISOString() })
    };
  }
}
