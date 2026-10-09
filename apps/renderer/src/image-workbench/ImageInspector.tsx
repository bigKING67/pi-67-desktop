import { Clock, Download, Layers, SlidersHorizontal, Sparkles } from "lucide-react";
import { Tab, TabList, TabPanel, Tabs } from "react-aria-components";
import { ImageCandidatesPanel, ImageExportPanel, ImageHistoryPanel } from "./ImageInspectorPanels.js";
import { ImageLayersPanel } from "./ImageLayersPanel.js";
import { ImagePropertiesPanel } from "./ImagePropertiesPanel.js";
import { useImageWorkbench, type ImageInspectorTab } from "./image-workbench-store.js";
import styles from "./ImageInspector.module.css";

/**
 * The image Inspector (product model §6): five equal-width tabs in the shared
 * Inspector pane, so docking, the drawer, the TitleBar toggle and ⌘⇧B behave
 * exactly as for the Work Inspector.
 */
export function ImageInspector() {
  const tab = useImageWorkbench((state) => state.inspectorTab);
  const setTab = useImageWorkbench((state) => state.setInspectorTab);
  return (
    <aside aria-label="图像检查器" className="context-pane" id="task-inspector">
      <Tabs className="context-pane-root-tabs" selectedKey={tab} onSelectionChange={(key) => setTab(String(key) as ImageInspectorTab)}>
        <TabList aria-label="图像检查器" className="context-pane-tabs">
          <Tab id="layers"><Layers aria-hidden="true" className="context-pane-tab-icon" size={14} /><span>图层</span></Tab>
          <Tab id="properties"><SlidersHorizontal aria-hidden="true" className="context-pane-tab-icon" size={14} /><span>属性</span></Tab>
          <Tab id="candidates"><Sparkles aria-hidden="true" className="context-pane-tab-icon" size={14} /><span>候选</span></Tab>
          <Tab id="history"><Clock aria-hidden="true" className="context-pane-tab-icon" size={14} /><span>历史</span></Tab>
          <Tab id="export"><Download aria-hidden="true" className="context-pane-tab-icon" size={14} /><span>导出</span></Tab>
        </TabList>
        <TabPanel className={`context-panel ${styles.panel}`} id="layers"><ImageLayersPanel /></TabPanel>
        <TabPanel className={`context-panel ${styles.panel}`} id="properties"><ImagePropertiesPanel /></TabPanel>
        <TabPanel className={`context-panel ${styles.panel}`} id="candidates"><ImageCandidatesPanel /></TabPanel>
        <TabPanel className={`context-panel ${styles.panel}`} id="history"><ImageHistoryPanel /></TabPanel>
        <TabPanel className={`context-panel ${styles.panel}`} id="export"><ImageExportPanel /></TabPanel>
      </Tabs>
    </aside>
  );
}
