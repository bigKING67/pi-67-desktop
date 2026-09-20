import { describe, expect, it, vi } from "vitest";
import { LocalMemorySupervisor } from "./local-memory-supervisor.js";

const connection = { endpoint: "http://127.0.0.1:43210", apiKey: "synthetic-scoped-key",
  localProfileId: "profile-1", account: "private-profile-1", user: "local-user" };
const request = { type: "local-memory-connect", requestId: "request-1" };

describe("Main local memory broker", () => {
  it("fails unconfigured requests closed and refuses caller-supplied targets", async () => {
    const broker = new LocalMemorySupervisor(() => undefined);
    expect(broker.operation({ ...request, endpoint: "https://other.test" })).toBeUndefined();
    await expect(broker.operation(request)).resolves.toMatchObject({ ok: false, errorCode: "NOT_CONFIGURED" });
  });

  it("coalesces concurrent connects and returns only scoped connection data", async () => {
    const service = { connect: vi.fn(async () => connection), stop: vi.fn(async () => undefined) };
    const broker = new LocalMemorySupervisor(() => service);
    const first = broker.operation(request);
    const second = broker.operation({ ...request, requestId: "request-2" });
    await expect(first).resolves.toMatchObject({ ok: true, connection });
    await expect(second).resolves.toMatchObject({ ok: true, requestId: "request-2" });
    expect(service.connect).toHaveBeenCalledTimes(1);
    await broker.stop();
    await broker.stop();
    expect(service.stop).toHaveBeenCalledTimes(1);
  });

  it("redacts native failures and rejects invalid service output", async () => {
    const service = { connect: vi.fn(async () => { throw new Error("SECRET_MODEL_KEY"); }), stop: async () => undefined };
    const broker = new LocalMemorySupervisor(() => service);
    const result = await broker.operation(request);
    expect(result).toEqual({ type: "local-memory-connect-result", requestId: "request-1", ok: false, errorCode: "RUNTIME_UNAVAILABLE" });
    for (const endpoint of ["https://remote.test", "http://127.0.0.1:99999", "http://localhost:1933"]) {
      const invalid = new LocalMemorySupervisor(() => ({ connect: async () => ({ ...connection, endpoint }), stop: async () => undefined }));
      await expect(invalid.operation(request)).resolves.toMatchObject({ ok: false, errorCode: "RUNTIME_UNAVAILABLE" });
    }
  });

  it("suppresses credentials when shutdown races startup", async () => {
    let complete!: (value: typeof connection) => void;
    const service = { connect: () => new Promise<typeof connection>((resolve) => { complete = resolve; }),
      stop: vi.fn(async () => undefined) };
    const broker = new LocalMemorySupervisor(() => service);
    const pending = broker.operation(request);
    await broker.stop();
    complete(connection);
    await expect(pending).resolves.toMatchObject({ ok: false, errorCode: "STOPPING" });
    await expect(broker.operation(request)).resolves.toMatchObject({ ok: false, errorCode: "STOPPING" });
  });
});
