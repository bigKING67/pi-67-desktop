import { useEffect, useRef, useState } from "react";
import { newMoneyErrorMessage } from "../context-memory/new-money-error-message.js";
import { Button } from "react-aria-components";
import { buildEnterpriseKnowledgeIndex, syncEnterpriseKnowledge } from "../context-memory/context-memory-controller.js";
import { SettingsNotice, SettingsRow, SettingsRows } from "./SettingsPrimitives.js";
import styles from "./ContextMemorySettings.module.css";

/** Parent keys this component by saved identity and selected scope. */
export function SharedKnowledgeSyncSettings({ teamId, projectId }: { teamId: string; projectId?: string }) {
  const active = useRef<AbortController | undefined>(undefined);
  const [pending, setPending] = useState<"sync" | "index">();
  const [notice, setNotice] = useState<{ text: string; failed: boolean }>();
  useEffect(() => () => { const request = active.current; active.current = undefined; request?.abort(); }, []);
  const execute = async (kind: "sync" | "index", project: string | undefined) => {
    if (active.current) return;
    const request = new AbortController(); active.current = request;
    setPending(kind); setNotice(undefined);
    try {
      const text = kind === "sync"
        ? `已接收${project ? "当前项目" : "当前团队"}内容（${(await syncEnterpriseKnowledge(teamId, project, request.signal)).pages} 页）。这不代表检索索引已就绪。`
        : await buildEnterpriseKnowledgeIndex(teamId, project, request.signal).then(() =>
          `本次${project ? "项目" : "团队"}索引已构建。检索功能尚未默认启用；内容或权限变化后仍需重新核验。`);
      if (active.current !== request || request.signal.aborted) return;
      setNotice({ failed: false, text });
    } catch (error) {
      if (active.current !== request) return;
      setNotice({ failed: kind === "index" || !request.signal.aborted, text: kind === "index"
        ? request.signal.aborted ? "已请求停止构建，结果尚未确认；已有内容保留，请勿立即重复构建。"
          : `构建未确认完成：${newMoneyErrorMessage(error, "请检查本地运行包、模型配置和团队权限。")} 不会自动重试。`
        : request.signal.aborted
        ? "已取消同步；已接收的数据保留在本地。"
        : `同步未完成：${newMoneyErrorMessage(error, "请稍后重试。")} 已保存的进度会保留。` });
    } finally {
      if (active.current === request) { active.current = undefined; setPending(undefined); }
    }
  };
  return <>
    <SettingsRows>
    <SettingsRow title="共享内容同步" description="仅接收所选团队或当前绑定项目的经验与 SOP，不上传私人记忆。" actions={
      <div className={styles.syncActions}>
        <Button className="secondary-button" isDisabled={!!pending} onPress={() => void execute("sync", undefined)}>同步团队内容</Button>
        <Button className="secondary-button" isDisabled={!!pending || !projectId} onPress={() => void execute("sync", projectId)}>同步当前项目</Button>
        {pending === "sync" ? <Button className="secondary-button" onPress={() => {
          setNotice({ failed: false, text: "已取消同步；已接收的数据保留在本地。" }); active.current?.abort();
        }}>取消同步</Button> : null}
      </div>
    } />
    <SettingsRow title="本地共享索引" description="先同步内容，再使用你已保存的模型构建索引，可能产生模型费用。需要独立团队运行包；不上传私人记忆。" actions={
      <div className={styles.syncActions}>
        <Button className="secondary-button" isDisabled={!!pending} onPress={() => void execute("index", undefined)}>构建团队索引</Button>
        <Button className="secondary-button" isDisabled={!!pending || !projectId} onPress={() => void execute("index", projectId)}>构建当前项目索引</Button>
        {pending === "index" ? <Button className="secondary-button" isDisabled={!!active.current?.signal.aborted} onPress={() => {
          setNotice({ failed: true, text: "已请求停止构建，结果尚未确认；已有内容保留，请勿立即重复构建。" }); active.current?.abort();
        }}>停止构建</Button> : null}
      </div>
    } />
    </SettingsRows>
    {pending || notice ? <SettingsNotice tone={notice?.failed ? "warning" : "info"}>
      {pending && !active.current?.signal.aborted ? pending === "index" ? "正在同步并构建本地索引，可能需要数分钟…" : "正在接收共享内容…" : notice?.text}
    </SettingsNotice> : null}
  </>;
}
