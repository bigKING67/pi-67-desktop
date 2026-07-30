export interface HighlightToken {
  content: string;
  color?: string;
}

export interface WorkerHighlightRequest {
  id: number;
  code: string;
  language?: string;
}

interface CodeHighlighterWorkerCoreOptions {
  aliases: Readonly<Record<string, string>>;
  loadLanguage: (language: string) => Promise<void>;
  tokenize: (code: string, language: string) => Promise<HighlightToken[][]>;
}

export interface CodeHighlighterWorkerCore {
  highlight(request: WorkerHighlightRequest): Promise<HighlightToken[][]>;
}

export function createCodeHighlighterWorkerCore(
  options: CodeHighlighterWorkerCoreOptions
): CodeHighlighterWorkerCore {
  const loadedLanguages = new Set<string>();
  const pendingLanguages = new Map<string, Promise<void>>();

  const ensureLanguage = (language: string): Promise<void> => {
    if (loadedLanguages.has(language)) return Promise.resolve();
    const existing = pendingLanguages.get(language);
    if (existing) return existing;
    const loading = options.loadLanguage(language).then(() => {
      loadedLanguages.add(language);
    }).finally(() => {
      pendingLanguages.delete(language);
    });
    pendingLanguages.set(language, loading);
    return loading;
  };

  return {
    async highlight(request) {
      const normalizedLanguage = request.language
        ? options.aliases[request.language.toLowerCase()]
        : undefined;
      if (!normalizedLanguage) {
        return request.code.split("\n").map((content) => [{ content }]);
      }
      await ensureLanguage(normalizedLanguage);
      return options.tokenize(request.code, normalizedLanguage);
    }
  };
}
