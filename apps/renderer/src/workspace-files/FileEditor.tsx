import { basicSetup, EditorView } from "codemirror";
import { languages } from "@codemirror/language-data";
import { useEffect, useRef } from "react";

export interface FileEditorProps {
  content: string;
  fileName: string;
  onChange: (content: string) => void;
  onSave: () => void;
}

export function FileEditor({ content, fileName, onChange, onSave }: FileEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const initialContent = useRef(content).current;
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  useEffect(() => {
    let disposed = false;
    let view: EditorView | undefined;
    void loadLanguage(fileName).then((language) => {
      if (disposed || !containerRef.current) return;
      view = createEditor(containerRef.current, initialContent, fileName, language);
      view.focus();
    }).catch(() => {
      if (disposed || !containerRef.current) return;
      view = createEditor(containerRef.current, initialContent, fileName);
    });
    return () => {
      disposed = true;
      view?.destroy();
    };
  }, [fileName, initialContent]);

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

async function loadLanguage(fileName: string) {
  const extension = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".") + 1).toLocaleLowerCase() : "";
  const description = languages.find((candidate) => (
    candidate.extensions.includes(extension)
    || (candidate.filename ? new RegExp(candidate.filename.source, candidate.filename.flags).test(fileName) : false)
  ));
  return description ? description.load() : undefined;
}
