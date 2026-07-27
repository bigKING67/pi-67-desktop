import type { ExtensionCompatibility, SessionTreeNodeView } from "@pi67/domain";
import { FileDiff, GitBranch, Gauge, PackageOpen } from "lucide-react";
import { Button, Tab, TabList, TabPanel, Tabs } from "react-aria-components";
import { Virtuoso } from "react-virtuoso";
import { useSessionProjectionStore } from "../session/session-projection-store.js";
import {
  selectSessionId,
  selectSessionName,
  selectSessionResources,
  selectSessionStats
} from "../session/session-projection-selectors.js";
import { ChangesPanel } from "../changes/ChangesPanel.js";
import { ExtensionCatalog } from "../extension-ui/ExtensionCatalog.js";
import {
  useCommittedExtensionCatalog,
  useExtensionUiStore
} from "../extension-ui/extension-ui-store.js";
import { reloadSessionResources } from "../session/session-control-controller.js";
import { rollbackRendererSession } from "../session/session-lifecycle-controller.js";
import { useCommittedSessionTreeProjection } from "../session-tree/session-tree-store.js";
import { useShellStore } from "../shell/shell-store.js";

export function ContextPane() {
  const sessionId = useSessionProjectionStore(selectSessionId);
  const sessionName = useSessionProjectionStore(selectSessionName);
  const stats = useSessionProjectionStore(selectSessionStats);
  const resources = useSessionProjectionStore(selectSessionResources);
  const { tree, status: sessionTreeStatus } = useCommittedSessionTreeProjection();
  const statuses = useExtensionUiStore((state) => state.statuses);
  const compatibility = useExtensionUiStore((state) => state.compatibility);
  const extensionCatalog = useCommittedExtensionCatalog();
  const selectedTab = useShellStore((state) => state.contextTab);
  const setSelectedTab = useShellStore((state) => state.setContextTab);
  const treeEntries = tree.nodes;

  return (
    <aside aria-label="会话上下文" className="context-pane" id="session-context">
      <Tabs selectedKey={selectedTab} onSelectionChange={(key) => setSelectedTab(String(key) as typeof selectedTab)}>
        <TabList aria-label="会话检查器">
          <Tab id="changes"><FileDiff size={14} />修改</Tab>
          <Tab id="session"><GitBranch size={14} />会话</Tab>
          <Tab id="context"><Gauge size={14} />上下文</Tab>
        </TabList>
        <TabPanel id="changes" className="context-panel">
          <ChangesPanel />
        </TabPanel>
        <TabPanel id="session" className="context-panel">
          <div className="context-heading">
            <div>
              <span className="section-label">当前分支</span>
              <strong>
                {tree.truncated ? `显示 ${treeEntries.length} / ${tree.total} 个节点` : `${treeEntries.length} 个节点`}
                {sessionTreeStatus === "loading" || sessionTreeStatus === "stale" ? " · 等待同步" : ""}
              </strong>
            </div>
          </div>
          <div className="session-tree" data-entry-count={treeEntries.length}>
            {treeEntries.length ? (
              <Virtuoso
                data={treeEntries}
                itemContent={(_index, entry) => (
                  <TreeNode node={entry} onSelect={(id) => void rollbackRendererSession(id)} />
                )}
              />
            ) : <ContextEmpty text="发送第一条消息后，会话节点会显示在这里。" />}
          </div>
        </TabPanel>
        <TabPanel id="context" className="context-panel">
          <dl className="metric-list">
            <div><dt>Session</dt><dd>{sessionName ?? sessionId?.slice(0, 8) ?? "-"}</dd></div>
            <div><dt>Tokens</dt><dd>{stats?.tokens.toLocaleString() ?? "0"}</dd></div>
            <div><dt>Context</dt><dd>{stats?.contextPercent === undefined ? "-" : `${stats.contextPercent.toFixed(1)}%`}</dd></div>
            <div><dt>Cost</dt><dd>${stats?.cost.toFixed(4) ?? "0.0000"}</dd></div>
          </dl>
          <div className="status-list">
            <span className="section-label">Extension 状态</span>
            {Object.keys(statuses).length === 0
              ? <ContextEmpty text="没有 Extension 状态消息。" />
              : Object.values(statuses).map((item) => (
                  <div key={item.id}><code>{item.key}</code><span>{item.message}</span></div>
                ))}
          </div>
          <div className="status-list">
            <span className="section-label">实时 UI 兼容性</span>
            {Object.keys(compatibility).length === 0
              ? <ContextEmpty text="尚无 Extension 兼容性报告。" />
              : Object.values(compatibility).map((item) => (
                  <div key={item.id}>
                    <code>{item.label}</code>
                    <span>{compatibilityLabel(item.status)} · {item.detail}</span>
                  </div>
                ))}
          </div>
          <ExtensionCatalog catalog={extensionCatalog} />
          <div className="context-heading"><div><span className="section-label"><PackageOpen size={13} /> Pi 资源</span><strong>{resources?.length ?? 0} 项</strong></div><Button className="small-button" onPress={() => void reloadSessionResources()}>重新加载</Button></div>
          <div className="resource-list">
            {resources?.length ? resources.map((resource) => (
              <div className="resource-row" key={`${resource.kind}-${resource.id}`}>
                <span className={`resource-status status-${resource.status}`} aria-label={resource.status} />
                <div><strong>{resource.label}</strong><small>{resource.kind}{resource.detail ? ` · ${resource.detail}` : ""}</small></div>
              </div>
            )) : <ContextEmpty text="尚未发现 Skills、Prompts、Extensions 或上下文文件。" />}
          </div>
        </TabPanel>
      </Tabs>
    </aside>
  );
}

function TreeNode({ node, onSelect }: { node: SessionTreeNodeView; onSelect: (id: string) => void }) {
  return (
    <div className="tree-node" style={{ paddingLeft: `${Math.min(node.depth, 6) * 8}px` }}>
      <button className={node.active ? "is-active" : ""} type="button" onClick={() => onSelect(node.id)} title="将活动分支移动到此节点">
        <span className="tree-rail" aria-hidden="true" />
        <span><strong>{node.label ?? node.type}</strong><small>{node.preview || "Session entry"}</small></span>
      </button>
    </div>
  );
}

function ContextEmpty({ text }: { text: string }) {
  return <p className="context-empty">{text}</p>;
}

function compatibilityLabel(status: ExtensionCompatibility): string {
  if (status === "native") return "原生支持";
  if (status === "headless") return "无界面运行";
  if (status === "adapter") return "展示适配";
  if (status === "partial") return "部分支持";
  if (status === "tui-only") return "仅 Pi TUI";
  return "不支持";
}
