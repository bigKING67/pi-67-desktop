import { parentPort, workerData } from "node:worker_threads";
import { isAbsolute } from "node:path";
import { ContentIndexWorkerEngine } from "./session-content-index-worker-engine.js";

if (!parentPort || !workerData || typeof workerData.directory !== "string"
  || !isAbsolute(workerData.directory)
  || (workerData.storageRoot !== undefined && (typeof workerData.storageRoot !== "string" || !isAbsolute(workerData.storageRoot)))) {
  throw new Error("Invalid content index worker configuration.");
}
const engine = new ContentIndexWorkerEngine(workerData.directory, workerData.storageRoot);
let busy = false;
parentPort.on("message", (message: unknown) => {
  if (busy) { process.exitCode = 1; parentPort!.close(); return; }
  busy = true;
  void engine.execute(message).then(
    reply => { busy = false; parentPort!.postMessage(reply); },
    () => { parentPort!.postMessage({ id: typeof message === "object" && message !== null && "id" in message ? message.id : 0, ok: false }); busy = false; }
  );
});
process.on("exit", () => engine.close());
