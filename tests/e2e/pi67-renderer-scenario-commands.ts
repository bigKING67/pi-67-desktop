import type { Page } from "@playwright/test";
import { recordedCommandDetails } from "./pi67-renderer-fixture.js";

const WORKBENCH_SETUP_OR_READ_COMMANDS = new Set([
  "workspace.open",
  "workspace.register",
  "workspace.changes",
  "command.list",
  "session.catalog.query"
]);

export async function scenarioCommands(
  page: Page
): Promise<Awaited<ReturnType<typeof recordedCommandDetails>>> {
  return (await recordedCommandDetails(page))
    .filter((command) => !WORKBENCH_SETUP_OR_READ_COMMANDS.has(command.type));
}

export async function scenarioCommandTypes(page: Page): Promise<string[]> {
  return (await scenarioCommands(page)).map((command) => command.type);
}
