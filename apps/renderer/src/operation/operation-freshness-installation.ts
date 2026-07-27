import type { AgentEvent, EventEnvelope } from "@pi67/protocol";

interface OperationFreshnessControllerModule {
  installOperationFreshnessController: () => () => void;
  observeOperationFreshnessEvent: (event: AgentEvent, envelope: EventEnvelope) => void;
  resetOperationFreshnessAfterPowerResume: () => void;
}

interface OperationFreshnessInstallationOptions {
  load?: () => Promise<OperationFreshnessControllerModule>;
  onLoadFailed?: () => void;
}

export interface OperationFreshnessInstallation {
  activate: () => void;
  deactivate: () => void;
  observe: (event: AgentEvent, envelope: EventEnvelope) => void;
  handlePowerResume: () => void;
}

export function createOperationFreshnessInstallation(
  options: OperationFreshnessInstallationOptions = {}
): OperationFreshnessInstallation {
  const load = options.load ?? (() => import("./operation-freshness-controller.js"));
  let active = false;
  let generation = 0;
  let controller: OperationFreshnessControllerModule | undefined;
  let disposeController: (() => void) | undefined;

  return {
    activate() {
      if (active) return;
      active = true;
      const activationGeneration = ++generation;
      void load().then((loadedController) => {
        if (!active || generation !== activationGeneration) return;
        const dispose = loadedController.installOperationFreshnessController();
        if (!active || generation !== activationGeneration) {
          dispose();
          return;
        }
        controller = loadedController;
        disposeController = dispose;
      }).catch(() => {
        if (active && generation === activationGeneration) options.onLoadFailed?.();
      });
    },

    deactivate() {
      active = false;
      generation += 1;
      const dispose = disposeController;
      controller = undefined;
      disposeController = undefined;
      dispose?.();
    },

    observe(event, envelope) {
      controller?.observeOperationFreshnessEvent(event, envelope);
    },

    handlePowerResume() {
      controller?.resetOperationFreshnessAfterPowerResume();
    }
  };
}
