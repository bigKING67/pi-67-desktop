import { MAX_CONTEXT_FILE_BYTES, type ContextFileSummary } from "@pi67/domain";
import {
  Code2,
  Eye,
  FolderOpen,
  Globe2,
  Save
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Button,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  TextArea
} from "react-aria-components";
import { MarkdownView } from "../transcript/MarkdownView.js";
import { useWorkbenchStore } from "../workbench/workbench-store.js";
import {
  loadContextFileCatalog,
  readContextFile,
  saveSelectedContextFile
} from "./context-file-controller.js";
import { useContextFileStore } from "./context-file-store.js";
import { ContextFileDiscardDialog } from "./ContextFileDiscardDialog.js";
import { useSettingsDraftRegistration } from "./SettingsDraftGuard.js";
import {
  contextFileAccessLabel,
  contextFileStatusLabel,
  contextFileScopeLabel,
  GlobalRuleCatalog,
  ProjectRuleCatalog
} from "./RuleSettingsCatalog.js";
import {
  SettingsBackAction,
  SettingsNotice,
  SettingsRow,
  SettingsRows,
  SettingsSectionBlock,
  SettingsToolbar
} from "./SettingsPrimitives.js";
import styles from "./RuleSettingsWorkspace.module.css";

type RuleScope = "global" | "project";
type DetailMode = "source" | "preview";

export function RuleSettingsWorkspace() {
  const settingsWorkspaceId = useWorkbenchStore((state) => state.settingsWorkspaceId);
  const currentWorkspaceId = useWorkbenchStore((state) => state.currentWorkspaceId);
  const workspaceId = settingsWorkspaceId ?? currentWorkspaceId;
  const workspace = useWorkbenchStore((state) => workspaceId ? state.workspaces[workspaceId] : undefined);
  const state = useContextFileStore();
  const [scope, setScope] = useState<RuleScope>("global");
  const [globalAdvancedOpen, setGlobalAdvancedOpen] = useState(false);
  const [projectAdvancedOpen, setProjectAdvancedOpen] = useState(false);
  const [mode, setMode] = useState<DetailMode>("source");
  const [discardOpen, setDiscardOpen] = useState(false);
  const pendingAction = useRef<(() => void) | undefined>(undefined);
  const listScrollTop = useRef<Record<string, number>>({});
  const previousWorkspaceId = useRef(workspaceId);
  const activeCatalogKey = `${workspaceId}:${scope}`;

  useSettingsDraftRegistration({
    dirty: state.dirty,
    busy: state.phase === "saving",
    subject: state.selectedItem?.name ?? "工作规则",
    discard: () => useContextFileStore.getState().discardDraft()
  });

  useEffect(() => {
    if (previousWorkspaceId.current !== workspaceId) {
      previousWorkspaceId.current = workspaceId;
      listScrollTop.current = {};
      setScope("global");
      setGlobalAdvancedOpen(false);
      setProjectAdvancedOpen(false);
      setMode("source");
    }
    if (!workspaceId) {
      useContextFileStore.getState().reset();
      return;
    }
    if (state.workspaceId !== workspaceId) {
      void loadContextFileCatalog(workspaceId);
    }
  }, [state.workspaceId, workspaceId]);

  useLayoutEffect(() => {
    const scrollRegion = settingsScrollRegion();
    if (!scrollRegion) return;
    if (state.selectedItem) scrollRegion.scrollTop = 0;
    else scrollRegion.scrollTop = listScrollTop.current[activeCatalogKey] ?? 0;
  }, [activeCatalogKey, state.selectedItem]);

  const requestNavigation = (action: () => void) => {
    if (!state.dirty) {
      action();
      return;
    }
    pendingAction.current = action;
    setDiscardOpen(true);
  };

  const rememberCatalogScroll = () => {
    if (state.selectedItem) return;
    listScrollTop.current[activeCatalogKey] = settingsScrollRegion()?.scrollTop ?? 0;
  };

  const selectItem = (item: ContextFileSummary) => requestNavigation(() => {
    listScrollTop.current[activeCatalogKey] = settingsScrollRegion()?.scrollTop ?? 0;
    setMode("source");
    void readContextFile(item.id, workspaceId);
  });

  if (!workspaceId || !workspace) {
    return (
      <SettingsSectionBlock
        title="工作规则"
        description="查看并管理 Pi 自动加载、在会话中持续生效的 Markdown 工作规则。"
      >
        <SettingsNotice>请先选择一个项目，再查看全局与项目工作规则。</SettingsNotice>
      </SettingsSectionBlock>
    );
  }

  const catalog = state.catalog?.items ?? [];
  return (
    <>
      <Tabs
        className={styles.workspace!}
        data-testid="rule-settings-workspace"
        selectedKey={scope}
        onSelectionChange={(key) => requestNavigation(() => {
          rememberCatalogScroll();
          useContextFileStore.getState().clearSelection();
          setMode("source");
          setScope(key === "project" ? "project" : "global");
        })}
      >
        <TabList aria-label="工作规则范围" className={styles.tabList!}>
          <Tab className={styles.tab!} id="global">
            <Globe2 aria-hidden="true" size={15} />全局
          </Tab>
          <Tab className={styles.tab!} id="project">
            <FolderOpen aria-hidden="true" size={15} />项目
          </Tab>
        </TabList>
        <TabPanel className={styles.tabPanel!} id="global">
          <GlobalRuleCatalog
            advancedOpen={globalAdvancedOpen}
            busy={state.phase === "loading-catalog"}
            detail={state.selectedItem ? <ContextFileDetail
              mode={mode}
              onBack={() => requestNavigation(() => useContextFileStore.getState().clearSelection())}
              onModeChange={setMode}
              onReload={() => requestNavigation(() => {
                useContextFileStore.getState().discardDraft();
                void readContextFile(state.selectedItem!.id, workspaceId);
              })}
            /> : undefined}
            error={state.error}
            items={catalog}
            onAdvancedOpenChange={setGlobalAdvancedOpen}
            onRefresh={() => void loadContextFileCatalog(workspaceId)}
            onSelect={selectItem}
          />
        </TabPanel>
        <TabPanel className={styles.tabPanel!} id="project">
          <ProjectRuleCatalog
            advancedOpen={projectAdvancedOpen}
            busy={state.phase === "loading-catalog"}
            detail={state.selectedItem ? <ContextFileDetail
              mode={mode}
              onBack={() => requestNavigation(() => useContextFileStore.getState().clearSelection())}
              onModeChange={setMode}
              onReload={() => requestNavigation(() => {
                useContextFileStore.getState().discardDraft();
                void readContextFile(state.selectedItem!.id, workspaceId);
              })}
            /> : undefined}
            error={state.error}
            items={catalog}
            onAdvancedOpenChange={setProjectAdvancedOpen}
            onRefresh={() => void loadContextFileCatalog(workspaceId)}
            onSelect={selectItem}
            trusted={state.catalog?.workspaceTrusted ?? workspace.trust === "trusted"}
            workspaceName={workspace.displayName}
          />
        </TabPanel>
      </Tabs>
      <ContextFileDiscardDialog
        busy={state.phase === "saving"}
        fileName={state.selectedItem?.name}
        open={discardOpen}
        onCancel={() => {
          pendingAction.current = undefined;
          setDiscardOpen(false);
        }}
        onDiscard={() => {
          const action = pendingAction.current;
          pendingAction.current = undefined;
          useContextFileStore.getState().discardDraft();
          setDiscardOpen(false);
          action?.();
        }}
      />
    </>
  );
}

function ContextFileDetail({ mode, onBack, onModeChange, onReload }: {
  mode: DetailMode;
  onBack: () => void;
  onModeChange: (mode: DetailMode) => void;
  onReload: () => void;
}) {
  const state = useContextFileStore();
  const item = state.selectedItem;
  const draft = state.draft;
  if (!item) return null;
  const writable = item.access === "editable" || item.access === "creatable";
  const byteLength = draft === undefined ? 0 : new TextEncoder().encode(draft).byteLength;
  const tooLarge = byteLength > MAX_CONTEXT_FILE_BYTES;
  const saveDisabled = !writable
    || !state.dirty
    || state.phase === "saving"
    || state.externalConflict
    || tooLarge;
  return (
    <div className={styles.detail} data-testid="context-file-detail">
      <SettingsBackAction label="返回工作规则" onPress={onBack}>返回工作规则</SettingsBackAction>
      <div className={styles.detailHeading}>
        <span>
          <span className="dialog-eyebrow">{contextFileScopeLabel(item.scope)} · {originLabel(item)}</span>
          <h2>{item.name}</h2>
          <code>{item.path}</code>
        </span>
        <strong className={styles.accessBadge} data-access={item.access}>{contextFileAccessLabel(item)}</strong>
      </div>
      <SettingsRows>
        <SettingsRow title="来源" value={originLabel(item)} />
        <SettingsRow title="作用域" value={contextFileScopeLabel(item.scope)} />
        <SettingsRow title="当前状态" value={contextFileStatusLabel(item)} />
        {item.detail ? <SettingsRow title="说明" value={item.detail} /> : null}
      </SettingsRows>
      {state.error && !state.externalConflict ? <SettingsNotice tone="danger">{state.error}</SettingsNotice> : null}
      {state.externalConflict ? <SettingsNotice
        tone="warning"
        testId="context-file-conflict"
        actions={<>
          <Button className="secondary-button" onPress={() => onModeChange("source")}>继续查看当前草稿</Button>
          <Button className="secondary-button" onPress={onReload}>重新读取最新文件</Button>
        </>}
      >
        文件已在外部修改。当前草稿仍被保留，但它基于旧版本，重新读取前不能保存。
      </SettingsNotice> : null}
      {tooLarge ? <SettingsNotice tone="danger">正文为 {formatBytes(byteLength)}，超过 1,000,000-byte 保存上限。</SettingsNotice> : null}
      <SettingsToolbar
        className={styles.toolbar!}
        status={<span>{state.phase === "loading-file" ? "正在读取…" : `${formatBytes(byteLength)} · UTF-8`}</span>}
        actions={<>
          <span aria-label="Markdown 显示模式" className={styles.modeSwitch} role="group">
            <Button className={mode === "source" ? styles.modeSelected! : ""} onPress={() => onModeChange("source")}>
              <Code2 aria-hidden="true" size={14} />源码
            </Button>
            <Button className={mode === "preview" ? styles.modeSelected! : ""} onPress={() => onModeChange("preview")}>
              <Eye aria-hidden="true" size={14} />预览
            </Button>
          </span>
          {writable ? <Button
            className="secondary-button"
            isDisabled={!state.dirty || state.phase === "saving"}
            onPress={() => useContextFileStore.getState().discardDraft()}
          >取消修改</Button> : null}
          {writable ? <Button
            className="primary-button"
            isDisabled={saveDisabled}
            onPress={() => void saveSelectedContextFile()}
          >
            <Save aria-hidden="true" size={14} />{state.phase === "saving" ? "保存中…" : "保存并重新加载"}
          </Button> : null}
        </>}
      />
      {draft === undefined ? <SettingsNotice>{state.phase === "loading-file" ? "正在读取 Markdown 正文…" : "正文尚未加载。"}</SettingsNotice> : mode === "preview" ? (
        <div className={styles.preview} data-testid="context-file-preview">
          {draft ? <MarkdownView mode="settled">{draft}</MarkdownView> : <p>Markdown 文件为空。</p>}
        </div>
      ) : (
        <TextArea
          aria-label={`${item.name} Markdown 源码`}
          className={styles.editor!}
          data-testid="context-file-editor"
          readOnly={!writable}
          spellCheck={false}
          value={draft}
          onChange={(event) => useContextFileStore.getState().updateDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
            event.preventDefault();
            if (!saveDisabled) void saveSelectedContextFile();
          }}
        />
      )}
    </div>
  );
}

function originLabel(item: ContextFileSummary): string {
  if (item.origin === "desktop") return "Pi-67 Desktop";
  if (item.origin === "user") return "用户全局配置";
  if (item.origin === "workspace") return "当前 Workspace";
  return "Workspace 外父目录";
}

function settingsScrollRegion(): HTMLDivElement | null {
  return document.querySelector<HTMLDivElement>('[data-testid="settings-scroll-region"]');
}

function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(2)} MB`;
}
