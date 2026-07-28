import { resolve } from "node:path";
import { PiConfigurationService } from "./pi-configuration-service.js";

export class PiConfigurationServiceRegistry {
  private readonly services = new Map<string, PiConfigurationService>();

  acquire(agentDir: string): PiConfigurationService {
    const canonical = resolve(agentDir);
    const existing = this.services.get(canonical);
    if (existing) return existing;
    const service = new PiConfigurationService(canonical);
    this.services.set(canonical, service);
    return service;
  }

  async dispose(): Promise<void> {
    const services = [...this.services.values()];
    this.services.clear();
    await Promise.all(services.map((service) => service.dispose()));
  }
}
