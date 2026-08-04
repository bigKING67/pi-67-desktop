export class SessionCatalogAutomaticTitlePublisher {
  private timer: ReturnType<typeof setTimeout> | undefined;

  schedule(isCurrent: () => boolean, publish: () => void): void {
    if (this.timer || !isCurrent()) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (isCurrent()) publish();
    }, 0);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
