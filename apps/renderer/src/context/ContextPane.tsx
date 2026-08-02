import { Files, Gauge, MessagesSquare } from "lucide-react";
import { Tab, TabList, TabPanel, Tabs } from "react-aria-components";
import { useShellStore } from "../shell/shell-store.js";
import { FilesPanel } from "./FilesPanel.js";
import { MessagesPanel } from "./MessagesPanel.js";
import { RuntimeContextPanel } from "./RuntimeContextPanel.js";

export function ContextPane() {
  const selectedTab = useShellStore((state) => state.contextTab);
  const setSelectedTab = useShellStore((state) => state.setContextTab);

  return (
    <aside aria-label="任务检查器" className="context-pane" id="task-inspector">
      <Tabs selectedKey={selectedTab} onSelectionChange={(key) => setSelectedTab(String(key) as typeof selectedTab)}>
        <TabList aria-label="任务检查器">
          <Tab id="files"><Files size={14} />文件</Tab>
          <Tab id="messages"><MessagesSquare size={14} />消息</Tab>
          <Tab id="context"><Gauge size={14} />上下文</Tab>
        </TabList>
        <TabPanel id="files" className="context-panel inspector-files-panel">
          <FilesPanel />
        </TabPanel>
        <TabPanel id="messages" className="context-panel inspector-messages-panel">
          <MessagesPanel />
        </TabPanel>
        <TabPanel id="context" className="context-panel">
          <RuntimeContextPanel />
        </TabPanel>
      </Tabs>
    </aside>
  );
}
