import { Bot, FilePenLine, Files, Gauge, MessagesSquare } from "lucide-react";
import { Tab, TabList, TabPanel, Tabs } from "react-aria-components";
import { ChangesPanel } from "../changes/ChangesPanel.js";
import { useShellStore } from "../shell/shell-store.js";
import { FilesPanel } from "./FilesPanel.js";
import { MessagesPanel } from "./MessagesPanel.js";
import { RuntimeContextPanel } from "./RuntimeContextPanel.js";
import { SubagentsPanel } from "../subagents/SubagentsPanel.js";

export function ContextPane() {
  const selectedTab = useShellStore((state) => state.contextTab);
  const setSelectedTab = useShellStore((state) => state.setContextTab);

  return (
    <aside aria-label="任务检查器" className="context-pane" id="task-inspector">
      <Tabs selectedKey={selectedTab} onSelectionChange={(key) => setSelectedTab(String(key) as typeof selectedTab)}>
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
          <ChangesPanel active={selectedTab === "changes"} />
        </TabPanel>
        <TabPanel id="messages" className="context-panel inspector-messages-panel">
          <MessagesPanel />
        </TabPanel>
        <TabPanel id="agents" className="context-panel inspector-agents-panel">
          <SubagentsPanel />
        </TabPanel>
        <TabPanel id="context" className="context-panel">
          <RuntimeContextPanel />
        </TabPanel>
      </Tabs>
    </aside>
  );
}
