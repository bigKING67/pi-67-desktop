import { basicSetup, EditorView } from "codemirror";
import { languages } from "@codemirror/language-data";
import { useEffect, useRef } from "react";
import type { WorkspaceFileNavigationIntent } from "./workspace-file-state.js";

export interface FileEditorProps {
  content: string;
  fileName: string;
  onChange: (content: string) => void;
  onSave: () => void;
  navigation?: WorkspaceFileNavigationIntent | undefined;
}

export function FileEditor({ content, fileName, onChange, onSave, navigation }: FileEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | undefined>(undefined);
  const navigationRef = useRef(navigation);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const initialContent = useRef(content).current;
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;
  navigationRef.current = navigation;

  useEffect(() => {
    let disposed = false;
    let view: EditorView | undefined;
    void loadLanguage(fileName).then((language) => {
      if (disposed || !containerRef.current) return;
      view = createEditor(containerRef.current, initialContent, fileName, language);
      viewRef.current = view;
      applyNavigation(view, navigationRef.current);
      view.focus();
    }).catch(() => {
      if (disposed || !containerRef.current) return;
      view = createEditor(containerRef.current, initialContent, fileName);
      viewRef.current = view;
      applyNavigation(view, navigationRef.current);
    });
    return () => {
      disposed = true;
      viewRef.current = undefined;
      view?.destroy();
    };
  }, [fileName, initialContent]);

  useEffect(() => {
    if (viewRef.current) applyNavigation(viewRef.current, navigation);
  }, [navigation?.nonce]);

  return (
    <div
      className="workspace-file-editor"
      ref={containerRef}
      onKeyDownCapture={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "s") {
          event.preventDefault();
          onSaveRef.current();
        }
      }}
    />
  );

  function createEditor(
    parent: HTMLDivElement,
    doc: string,
    name: string,
    language?: Awaited<ReturnType<typeof loadLanguage>>
  ): EditorView {
    return new EditorView({
      doc,
      parent,
      extensions: [
        basicSetup,
        ...(language ? [language] : []),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({
          "aria-label": `${name} 文件编辑器`,
          spellcheck: "false"
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        }),
        EditorView.theme({
          "&": {
            height: "100%",
            backgroundColor: "var(--surface)",
            color: "var(--text-primary)",
            fontSize: "12px"
          },
          ".cm-content": {
            caretColor: "var(--accent)",
            fontFamily: "var(--font-code)",
            lineHeight: "1.6",
            padding: "12px 0"
          },
          ".cm-scroller": { overflow: "auto" },
          ".cm-gutters": {
            backgroundColor: "var(--surface-muted)",
            borderRight: "1px solid var(--border)",
            color: "var(--text-tertiary)"
          },
          ".cm-activeLine, .cm-activeLineGutter": {
            backgroundColor: "color-mix(in srgb, var(--accent) 7%, transparent)"
          },
          ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
            backgroundColor: "var(--accent-soft) !important"
          },
          "&.cm-focused": { outline: "none" }
        })
      ]
    });
  }
}

function applyNavigation(
  view: EditorView,
  navigation: WorkspaceFileNavigationIntent | undefined
): void {
  if (!navigation || navigation.line > view.state.doc.lines) return;
  const line = view.state.doc.line(Math.max(1, navigation.line));
  const position = Math.min(line.to, line.from + Math.max(0, navigation.column - 1));
  view.dispatch({
    selection: { anchor: position },
    effects: EditorView.scrollIntoView(position, { y: "center" })
  });
}

async function loadLanguage(fileName: string) {
  const extension = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".") + 1).toLocaleLowerCase() : "";
  const description = languages.find((candidate) => (
    candidate.extensions.includes(extension)
    || (candidate.filename ? new RegExp(candidate.filename.source, candidate.filename.flags).test(fileName) : false)
  ));
  return description ? description.load() : undefined;
}
