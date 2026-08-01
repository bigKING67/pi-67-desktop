import { describe, expect, it } from "vitest";
import {
  EXTENSION_PACKAGE_REQUEST_TIMEOUT_MS,
  EXTENSION_PACKAGE_WORKER_TIMEOUT_MS,
  isWorkerBackedExtensionPackageCommand
} from "./extension-package-operation.js";

describe("Extension package operation timeout contract", () => {
  it("keeps the Renderer request alive after the isolated worker deadline", () => {
    expect(EXTENSION_PACKAGE_REQUEST_TIMEOUT_MS).toBeGreaterThan(EXTENSION_PACKAGE_WORKER_TIMEOUT_MS);
  });

  it.each([
    "extension.package.checkUpdates",
    "extension.package.install",
    "extension.package.update",
    "extension.package.uninstall"
  ] as const)("classifies %s as worker-backed", (type) => {
    expect(isWorkerBackedExtensionPackageCommand(type)).toBe(true);
  });

  it.each([
    "extension.package.list",
    "extension.package.setEnabled",
    "extension.package.restoreInheritance"
  ] as const)("keeps %s on the normal response contract", (type) => {
    expect(isWorkerBackedExtensionPackageCommand(type)).toBe(false);
  });
});
