import type { ExtensionCompatibility } from "@pi67/domain";
import { PackageOpen } from "lucide-react";
import { Button } from "react-aria-components";
import { ExtensionCatalog } from "../extension-ui/ExtensionCatalog.js";
import {
  useCommittedExtensionCatalog,
  useExtensionUiStore
} from "../extension-ui/extension-ui-store.js";
import { reloadSessionResources } from "../session/session-control-controller.js";
import {
  selectSessionId,
  selectSessionName,
  selectSessionResources,
  selectSessionStats
} from "../session/session-projection-selectors.js";
import { useSessionProjectionStore } from "../session/session-projection-store.js";

export function RuntimeContextPanel() {
  const sessionId = useSessionProjectionStore(selectSessionId);
  const sessionName = useSessionProjectionStore(selectSessionName);
  const stats = useSessionProjectionStore(selectSessionStats);
  const resources = useSessionProjectionStore(selectSessionResources);
  const statuses = useExtensionUiStore((state) => state.statuses);
  const compatibility = useExtensionUiStore((state) => state.compatibility);
  const extensionCatalog = useCommittedExtensionCatalog();

  return (
    <>
      <dl className="metric-list">
        <div><dt>会话</dt><dd>{sessionName ?? sessionId?.slice(0, 8) ?? "-"}</dd></div>
        <div><dt>Token</dt><dd>{stats?.tokens.toLocaleString() ?? "0"}</dd></div>
        <div><dt>上下文占用</dt><dd>{stats?.contextPercent === undefined ? "-" : `${stats.contextPercent.toFixed(1)}%`}</dd></div>
        <div><dt>费用</dt><dd>${stats?.cost.toFixed(4) ?? "0.0000"}</dd></div>
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
      <div className="context-heading">
        <div><span className="section-label"><PackageOpen size={13} /> Pi 资源</span><strong>{resources?.length ?? 0} 项</strong></div>
        <Button className="small-button" onPress={() => void reloadSessionResources()}>重新加载</Button>
      </div>
      <div className="resource-list">
        {resources?.length ? resources.map((resource) => (
          <div className="resource-row" key={`${resource.kind}-${resource.id}`}>
            <span className={`resource-status status-${resource.status}`} aria-label={resource.status} />
            <div><strong>{resource.label}</strong><small>{resource.kind}{resource.detail ? ` · ${resource.detail}` : ""}</small></div>
          </div>
        )) : <ContextEmpty text="尚未发现 Skills、Prompts、Extensions 或上下文文件。" />}
      </div>
    </>
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
