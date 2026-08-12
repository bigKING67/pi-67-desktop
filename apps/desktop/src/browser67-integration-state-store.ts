import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  parseBrowserState,
  readBoundedJson,
  type Browser67IntegrationState
} from "./desktop-capability-contract.js";

export class Browser67IntegrationStateStore {
  readonly #path: string;
  readonly #createToken: () => string;

  constructor(managedRoot: string, createToken: () => string = randomUUID) {
    this.#path = join(managedRoot, ".state", "integrations", "browser67.json");
    this.#createToken = createToken;
  }

  path(): string {
    return this.#path;
  }

  async read(): Promise<Browser67IntegrationState> {
    return parseBrowserState(await readBoundedJson(this.#path));
  }

  async write(state: Browser67IntegrationState): Promise<void> {
    const directory = dirname(this.#path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = join(directory, `.browser67.${process.pid}.${this.#createToken()}.tmp`);
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, this.#path);
    if (process.platform !== "win32") await chmod(this.#path, 0o600);
  }
}
