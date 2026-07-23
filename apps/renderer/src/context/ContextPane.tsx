import type { SessionTreeNodeView } from "@pi67/domain";
import { Activity, GitBranch, PackageOpen } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, Tab, TabList, TabPanel, Tabs } from "react-aria-components";
import { Virtuoso } from "react-virtuoso";
import { useAppStore } from "../app/app-store.js";

export function ContextPane() {
  const snapshot = useAppStore((state) => state.snapshot);
  const statuses = useAppStore((state) => state.extensionStatuses);
  const reloadResources = useAppStore((state) => state.reloadResources);
  const rollback = useAppStore((state) => state.rollback);
  const [selectedTab, setSelectedTab] = useState("tree");
  const treeEntries = useMemo(() => flattenTree(snapshot?.tree ?? []), [snapshot?.tree]);

  return (
    <aside className="context-pane">
      <Tabs selectedKey={selectedTab} onSelectionChange={(key) => setSelectedTab(String(key))}>
        <TabList aria-label="Session context">
          <Tab id="tree"><GitBranch size={14} />会话树</Tab>
          <Tab id="activity"><Activity size={14} />状态</Tab>
          <Tab id="resources"><PackageOpen size={14} />资源</Tab>
        </TabList>
        <TabPanel id="tree" className="context-panel">
          <div className="context-heading"><div><span className="section-label">当前分支</span><strong>{treeEntries.length} 个节点</strong></div></div>
          <div className="session-tree" data-entry-count={treeEntries.length}>
            {treeEntries.length ? (
              <Virtuoso
                data={treeEntries}
                itemContent={(_index, entry) => (
                  <TreeNode depth={entry.depth} node={entry.node} onSelect={(id) => void rollback(id)} />
                )}
              />
            ) : <ContextEmpty text="发送第一条消息后，会话节点会显示在这里。" />}
          </div>
        </TabPanel>
        <TabPanel id="activity" className="context-panel">
          <dl className="metric-list">
            <div><dt>Session</dt><dd>{snapshot?.sessionName ?? snapshot?.sessionId.slice(0, 8) ?? "-"}</dd></div>
            <div><dt>Tokens</dt><dd>{snapshot?.stats?.tokens.toLocaleString() ?? "0"}</dd></div>
            <div><dt>Context</dt><dd>{snapshot?.stats?.contextPercent === undefined ? "-" : `${snapshot.stats.contextPercent.toFixed(1)}%`}</dd></div>
            <div><dt>Cost</dt><dd>${snapshot?.stats?.cost.toFixed(4) ?? "0.0000"}</dd></div>
          </dl>
          <div className="status-list">
            <span className="section-label">Extension status</span>
            {Object.keys(statuses).length === 0 ? <ContextEmpty text="没有 extension 状态消息。" /> : Object.entries(statuses).map(([key, value]) => <div key={key}><code>{key}</code><span>{value}</span></div>)}
          </div>
        </TabPanel>
        <TabPanel id="resources" className="context-panel">
          <div className="context-heading"><div><span className="section-label">Pi resources</span><strong>{snapshot?.resources.length ?? 0} 项</strong></div><Button className="small-button" onPress={() => void reloadResources()}>重新加载</Button></div>
          <div className="resource-list">
            {snapshot?.resources.length ? snapshot.resources.map((resource) => (
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

function TreeNode({ node, depth, onSelect }: { node: SessionTreeNodeView; depth: number; onSelect: (id: string) => void }) {
  return (
    <div className="tree-node" style={{ paddingLeft: `${Math.min(depth, 6) * 8}px` }}>
      <button className={node.active ? "is-active" : ""} type="button" onClick={() => onSelect(node.id)} title="将活动分支移动到此节点">
        <span className="tree-rail" aria-hidden="true" />
        <span><strong>{node.label ?? node.type}</strong><small>{node.preview || "Session entry"}</small></span>
      </button>
    </div>
  );
}

interface FlatTreeEntry {
  node: SessionTreeNodeView;
  depth: number;
}

function flattenTree(roots: SessionTreeNodeView[]): FlatTreeEntry[] {
  const entries: FlatTreeEntry[] = [];
  const stack = roots.toReversed().map((node) => ({ node, depth: 0 }));
  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) break;
    entries.push(entry);
    for (let index = entry.node.children.length - 1; index >= 0; index -= 1) {
      const child = entry.node.children[index];
      if (child) stack.push({ node: child, depth: entry.depth + 1 });
    }
  }
  return entries;
}

function ContextEmpty({ text }: { text: string }) {
  return <p className="context-empty">{text}</p>;
}
