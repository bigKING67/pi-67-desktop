import { applyEdits, modify, type FormattingOptions } from "jsonc-parser";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { parseSettingsDocument } from "./pi-configuration-documents.js";

type JsonObject = Record<string, unknown>;

export type DesktopManagedPackageDocumentEntry = string | {
  source: string;
  extensions?: readonly string[];
  skills?: readonly string[];
  prompts?: readonly string[];
};

/** Projects Desktop-owned Packages without replacing user Packages or comments. */
export function setDesktopManagedPackagesDocument(
  content: string | undefined,
  managedRoot: string,
  packages: readonly DesktopManagedPackageDocumentEntry[]
): string {
  const source = content ?? "{}\n";
  const document = parseSettingsDocument(source);
  if (!isAbsolute(managedRoot)) throw new Error("Desktop managed Package root must be absolute.");
  const configured = document.root.packages;
  if (configured !== undefined && !Array.isArray(configured)) {
    throw new Error("settings.json packages must contain an array.");
  }
  const preserved = (configured ?? []).filter((entry) => {
    const packageSource = typeof entry === "string"
      ? entry
      : isPlainObject(entry) ? optionalString(entry.source) : undefined;
    return packageSource === undefined || !isSameOrContainedPath(packageSource, managedRoot);
  });
  const next = [
    ...preserved,
    ...packages.map((entry) => typeof entry === "string" ? entry : {
      ...entry,
      ...(entry.extensions === undefined ? {} : { extensions: [...entry.extensions] }),
      ...(entry.skills === undefined ? {} : { skills: [...entry.skills] }),
      ...(entry.prompts === undefined ? {} : { prompts: [...entry.prompts] })
    })
  ];
  return applyEdits(source, modify(source, ["packages"], next, {
    formattingOptions: formatting(source)
  }));
}

function isSameOrContainedPath(candidate: string, root: string): boolean {
  if (!isAbsolute(candidate)) return false;
  const normalize = process.platform === "win32"
    ? (value: string) => resolve(value).toLocaleLowerCase("en-US")
    : (value: string) => resolve(value);
  const fromRoot = relative(normalize(root), normalize(candidate));
  return fromRoot === "" || (
    fromRoot !== ".."
    && !fromRoot.startsWith(`..${sep}`)
    && !isAbsolute(fromRoot)
  );
}

function formatting(content: string): FormattingOptions {
  const line = content.split(/\r?\n/u).find((candidate) => /^\s+\S/u.test(candidate));
  const indentation = line?.match(/^\s+/u)?.[0] ?? "  ";
  return {
    insertSpaces: !indentation.includes("\t"),
    tabSize: indentation.includes("\t") ? 1 : Math.max(1, indentation.length),
    eol: content.includes("\r\n") ? "\r\n" : "\n"
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
