import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const SESSION_CREATION_TIMEOUT_MS = 30_000;
const SESSION_CREATION_PROMPT = "Create the packaged smoke Session.";

export async function verifyPackagedSessionCreation({ agentDir, window }) {
  const startedAt = Date.now();
  const deadline = startedAt + SESSION_CREATION_TIMEOUT_MS;
  const conversationRows = window.locator('[data-testid="conversation-row"]');
  await window.getByRole("button", { name: /新建会话$/u }).first().click({
    timeout: remainingTimeout(deadline, "start Session creation")
  });
  await conversationRows.nth(1).waitFor({
    state: "visible",
    timeout: remainingTimeout(deadline, "show the provisional conversation")
  });
  await window.getByRole("textbox", { name: "给 Pi 发送消息" }).fill(SESSION_CREATION_PROMPT);
  await window.getByRole("button", { name: "发送", exact: true }).click({
    timeout: remainingTimeout(deadline, "send the first Session message")
  });
  await window.locator(
    '[data-testid="conversation-row"][aria-current="page"][data-conversation-id^="session:"]'
  ).waitFor({
    state: "visible",
    timeout: remainingTimeout(deadline, "materialize the authoritative Session")
  });
  const stop = window.getByRole("button", { name: "停止", exact: true });
  await stop.waitFor({
    state: "visible",
    timeout: remainingTimeout(deadline, "start the controlled first turn")
  });
  await stop.click({ timeout: remainingTimeout(deadline, "stop the controlled first turn") });
  await stop.waitFor({
    state: "hidden",
    timeout: remainingTimeout(deadline, "finish the controlled first turn")
  });
  await window.locator('[data-runtime-phase="ready"]').waitFor({
    state: "visible",
    timeout: remainingTimeout(deadline, "reach ready state")
  });
  const marker = await waitForSessionCreationMarker(agentDir, deadline);
  const durationMs = Date.now() - startedAt;
  if (durationMs > SESSION_CREATION_TIMEOUT_MS) {
    throw new Error(`Packaged Session creation exceeded its bounded readiness window: ${durationMs}ms.`);
  }
  return { creationId: marker.creationId, durationMs };
}

async function waitForSessionCreationMarker(agentDir, deadline) {
  let lastFiles = [];
  while (Date.now() < deadline) {
    lastFiles = await findSessionJsonlFiles(join(agentDir, "sessions"));
    for (const path of lastFiles) {
      const entries = (await readFile(path, "utf8"))
        .split(/\r?\n/u)
        .filter(Boolean)
        .flatMap(parseJsonLine);
      const markers = entries.filter((entry) => (
        entry?.type === "custom"
        && entry.customType === "pi67.session-creation"
        && entry.data?.schemaVersion === 1
        && typeof entry.data.creationId === "string"
      ));
      if (markers.length === 1) return { creationId: markers[0].data.creationId };
      if (markers.length > 1) {
        throw new Error(`Packaged Pi JSONL contains ambiguous Session creation markers: ${path}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Packaged Session creation marker was not persisted in ${lastFiles.length} Pi JSONL files.`);
}

function remainingTimeout(deadline, stage) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    throw new Error(`Packaged Session creation exceeded its bounded readiness window before it could ${stage}.`);
  }
  return remaining;
}

function parseJsonLine(line) {
  try {
    return [JSON.parse(line)];
  } catch {
    return [];
  }
}

async function findSessionJsonlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findSessionJsonlFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
  }
  return files;
}
