import { createHighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import githubDark from "shiki/themes/github-dark-default.mjs";
import {
  createCodeHighlighterWorkerCore,
  type WorkerHighlightRequest
} from "./code-highlighter-worker-core.js";

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

const core = createCodeHighlighterWorkerCore({
  aliases: LANGUAGE_ALIASES,
  async loadLanguage(language) {
    const loader = LANGUAGE_LOADERS[language as SupportedLanguage];
    if (!loader) throw new Error(`Unsupported syntax-highlighting language: ${language}`);
    const module = await loader();
    const instance = await highlighter;
    await instance.loadLanguage(...module.default);
  },
  async tokenize(code, language) {
    const instance = await highlighter;
    const result = instance.codeToTokens(code, {
      lang: language as SupportedLanguage,
      theme: "github-dark-default"
    });
    return result.tokens.map((line) => line.map((token) => ({
      content: token.content,
      ...(token.color === undefined ? {} : { color: token.color })
    })));
  }
});

globalThis.addEventListener("message", (event: MessageEvent<WorkerHighlightRequest>) => {
  void core.highlight(event.data).then((lines) => {
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
