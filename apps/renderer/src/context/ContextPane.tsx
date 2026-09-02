import { Bot, BrainCircuit, FilePenLine, Files, Gauge, Lightbulb, MessagesSquare } from "lucide-react";
import { lazy, Suspense } from "react";
import { Tab, TabList, TabPanel, Tabs } from "react-aria-components";
import { useShellStore } from "../shell/shell-store.js";
import { FilesPanel } from "./FilesPanel.js";

const ChangesPanel = lazy(() => import("../changes/ChangesPanel.js").then((module) => ({
  default: module.ChangesPanel
})));
const MessagesPanel = lazy(() => import("./MessagesPanel.js").then((module) => ({
  default: module.MessagesPanel
})));
const RuntimeContextPanel = lazy(() => import("./RuntimeContextPanel.js").then((module) => ({
  default: module.RuntimeContextPanel
})));
const SubagentsPanel = lazy(() => import("../subagents/SubagentsPanel.js").then((module) => ({
  default: module.SubagentsPanel
})));
const MemoryInspectorPanel = lazy(() => import("../context-memory/MemoryInspectorPanel.js").then((module) => ({
  default: module.MemoryInspectorPanel
})));
const ExperienceInspectorPanel = lazy(() => import("../context-memory/ExperienceInspectorPanel.js").then((module) => ({
  default: module.ExperienceInspectorPanel
})));

export function ContextPane() {
  const selectedTab = useShellStore((state) => state.contextTab);
  const selectedDetailTab = useShellStore((state) => state.contextDetailTab);
  const setSelectedTab = useShellStore((state) => state.setContextTab);
  const setSelectedDetailTab = useShellStore((state) => state.setContextDetailTab);

  return (
    <aside aria-label="任务检查器" className="context-pane" id="task-inspector">
      <Tabs
        className="context-pane-root-tabs"
        selectedKey={selectedTab}
        onSelectionChange={(key) => setSelectedTab(String(key) as typeof selectedTab)}
      >
        <TabList aria-label="任务检查器" className="context-pane-tabs">
          <Tab id="files"><Files aria-hidden="true" className="context-pane-tab-icon" size={14} /><span>文件</span></Tab>
          <Tab id="changes"><FilePenLine aria-hidden="true" className="context-pane-tab-icon" size={14} /><span>修改</span></Tab>
          <Tab id="messages"><MessagesSquare aria-hidden="true" className="context-pane-tab-icon" size={14} /><span>消息</span></Tab>
          <Tab id="agents"><Bot aria-hidden="true" className="context-pane-tab-icon" size={14} /><span>代理</span></Tab>
          <Tab id="context"><Gauge aria-hidden="true" className="context-pane-tab-icon" size={14} /><span>上下文</span></Tab>
        </TabList>
        <TabPanel id="files" className="context-panel inspector-files-panel">
          <FilesPanel />
        </TabPanel>
        <TabPanel id="changes" className="context-panel inspector-changes-panel">
          {selectedTab === "changes" ? (
            <Suspense fallback={<ContextPanelLoadingState />}><ChangesPanel active /></Suspense>
          ) : null}
        </TabPanel>
        <TabPanel id="messages" className="context-panel inspector-messages-panel">
          {selectedTab === "messages" ? (
            <Suspense fallback={<ContextPanelLoadingState />}><MessagesPanel /></Suspense>
          ) : null}
        </TabPanel>
        <TabPanel id="agents" className="context-panel inspector-agents-panel">
          {selectedTab === "agents" ? (
            <Suspense fallback={<ContextPanelLoadingState />}><SubagentsPanel /></Suspense>
          ) : null}
        </TabPanel>
        <TabPanel id="context" className="context-panel inspector-context-panel">
          {selectedTab === "context" ? (
            <Tabs
              className="context-detail-tabs"
              selectedKey={selectedDetailTab}
              onSelectionChange={(key) => setSelectedDetailTab(String(key) as typeof selectedDetailTab)}
            >
              <TabList aria-label="上下文检查器" className="context-detail-tab-list">
                <Tab id="session"><Gauge aria-hidden="true" size={13} /><span>会话</span></Tab>
                <Tab id="memory"><BrainCircuit aria-hidden="true" size={13} /><span>记忆</span></Tab>
                <Tab id="experience"><Lightbulb aria-hidden="true" size={13} /><span>经验</span></Tab>
              </TabList>
              <TabPanel id="session" className="context-detail-panel">
                {selectedDetailTab === "session" ? (
                  <Suspense fallback={<ContextPanelLoadingState />}><RuntimeContextPanel /></Suspense>
                ) : null}
              </TabPanel>
              <TabPanel id="memory" className="context-detail-panel">
                {selectedDetailTab === "memory" ? (
                  <Suspense fallback={<ContextPanelLoadingState />}><MemoryInspectorPanel /></Suspense>
                ) : null}
              </TabPanel>
              <TabPanel id="experience" className="context-detail-panel">
                {selectedDetailTab === "experience" ? (
                  <Suspense fallback={<ContextPanelLoadingState />}><ExperienceInspectorPanel /></Suspense>
                ) : null}
              </TabPanel>
            </Tabs>
          ) : null}
        </TabPanel>
      </Tabs>
    </aside>
  );
}

function ContextPanelLoadingState() {
  return <p aria-busy="true" className="context-empty" role="status">正在加载检查器…</p>;
}
