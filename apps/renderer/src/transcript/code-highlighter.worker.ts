import { createHighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import githubDark from "shiki/themes/github-dark-default.mjs";
import type { HighlightToken } from "./code-highlighter.js";

const highlighter = createHighlighterCore({
  themes: [githubDark],
  langs: [],
  engine: createOnigurumaEngine(import("shiki/wasm"))
});

const LANGUAGE_LOADERS = {
  bash: () => import("shiki/langs/bash.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  csharp: () => import("shiki/langs/csharp.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  jsonc: () => import("shiki/langs/jsonc.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  powershell: () => import("shiki/langs/powershell.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  shellscript: () => import("shiki/langs/shellscript.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs")
} as const;

type SupportedLanguage = keyof typeof LANGUAGE_LOADERS;
const loadedLanguages = new Set<SupportedLanguage>();
const pendingLanguages = new Map<SupportedLanguage, Promise<void>>();

const LANGUAGE_ALIASES: Readonly<Record<string, SupportedLanguage>> = {
  bash: "bash",
  c: "cpp",
  cpp: "cpp",
  cs: "csharp",
  csharp: "csharp",
  css: "css",
  diff: "diff",
  go: "go",
  html: "html",
  java: "java",
  javascript: "javascript",
  js: "javascript",
  json: "json",
  jsonc: "jsonc",
  markdown: "markdown",
  md: "markdown",
  powershell: "powershell",
  ps1: "powershell",
  py: "python",
  python: "python",
  rust: "rust",
  rs: "rust",
  sh: "shellscript",
  shell: "shellscript",
  shellscript: "shellscript",
  sql: "sql",
  ts: "typescript",
  tsx: "tsx",
  typescript: "typescript",
  yaml: "yaml",
  yml: "yaml"
};

interface HighlightRequest {
  id: number;
  code: string;
  language?: string;
}

globalThis.addEventListener("message", (event: MessageEvent<HighlightRequest>) => {
  void highlightCode(event.data).then((lines) => {
    globalThis.postMessage({
      id: event.data.id,
      ok: true,
      lines,
      resources: performance.getEntriesByType("resource").map((entry) => entry.name)
    });
  }).catch((error: unknown) => {
    globalThis.postMessage({
      id: event.data.id,
      ok: false,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    });
  });
});

async function highlightCode(request: HighlightRequest): Promise<HighlightToken[][]> {
  const instance = await highlighter;
  const normalizedLanguage = request.language ? LANGUAGE_ALIASES[request.language.toLowerCase()] : undefined;
  if (!normalizedLanguage) return request.code.split("\n").map((content) => [{ content }]);
  await ensureLanguage(normalizedLanguage);
  const result = instance.codeToTokens(request.code, {
    lang: normalizedLanguage,
    theme: "github-dark-default"
  });
  return result.tokens.map((line) => line.map((token) => ({
    content: token.content,
    ...(token.color === undefined ? {} : { color: token.color })
  })));
}

async function ensureLanguage(language: SupportedLanguage): Promise<void> {
  if (loadedLanguages.has(language)) return;
  const existing = pendingLanguages.get(language);
  if (existing) return existing;
  const loading = LANGUAGE_LOADERS[language]().then(async (module) => {
    const instance = await highlighter;
    await instance.loadLanguage(...module.default);
    loadedLanguages.add(language);
  }).finally(() => pendingLanguages.delete(language));
  pendingLanguages.set(language, loading);
  return loading;
}
