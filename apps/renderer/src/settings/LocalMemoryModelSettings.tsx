import type { ReactNode } from "react";
import type { LocalMemorySettingsSnapshot } from "@pi67/protocol";
import { Eye, EyeOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, Input } from "react-aria-components";
import { SettingsInfo, SettingsNotice, SettingsRow, SettingsRows, SettingsSectionBlock } from "./SettingsPrimitives.js";
import { useSettingsDraftRegistration } from "./SettingsDraftGuard.js";
import styles from "./ContextMemorySettings.module.css";
import { LocalMemoryRuntimeSettings } from "./LocalMemoryRuntimeSettings.js";
import { LocalMemoryActivationSettings } from "./LocalMemoryActivationSettings.js";

const empty = { provider: "", extraction: "", plannerProvider: "", planner: "", endpoint: "", model: "", dimension: "" };
function fields(snapshot: LocalMemorySettingsSnapshot) {
  return snapshot.status !== "configured" ? { ...empty } : {
    provider: snapshot.extraction.provider, extraction: snapshot.extraction.model,
    plannerProvider: snapshot.queryPlanner?.provider ?? "", planner: snapshot.queryPlanner?.model ?? "",
    endpoint: snapshot.embedding.endpoint, model: snapshot.embedding.model, dimension: String(snapshot.embedding.dimension)
  };
}
export function LocalMemoryModelSettings({ onPendingChange, children }: { onPendingChange?: (pending: boolean) => void; children?: ReactNode }) {
  const bridge = window.pi67?.system.localMemoryModels;
  const [snapshot, setSnapshot] = useState<LocalMemorySettingsSnapshot>();
  const [draft, setDraft] = useState({ ...empty });
  const [replacement, setReplacement] = useState("");
  const [revealed, setRevealed] = useState<string>();
  const [visible, setVisible] = useState(false);
  const [loadingKey, setLoadingKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [runtimePending, setRuntimePending] = useState(false);
  const [activationPending, setActivationPending] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const generation = useRef(0);
  const mounted = useRef(false);
  const hide = () => { generation.current++; setRevealed(undefined); setVisible(false); setLoadingKey(false); };
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    void (bridge?.get() ?? Promise.resolve({ status: "unavailable" } as const)).then((value) => {
      if (!cancelled) { setSnapshot(value); setDraft(fields(value)); }
    }).catch(() => { if (!cancelled) setError("无法读取模型设置，请重新打开此页重试。"); });
    const conceal = () => hide();
    const visibility = () => { if (document.hidden) hide(); };
    window.addEventListener("blur", conceal); document.addEventListener("visibilitychange", visibility);
    return () => {
      cancelled = true; mounted.current = false; generation.current++;
      window.removeEventListener("blur", conceal); document.removeEventListener("visibilitychange", visibility);
    };
  }, [bridge]);
  const dirty = !!snapshot && (JSON.stringify(draft) !== JSON.stringify(fields(snapshot)) || replacement.length > 0);
  useEffect(() => { onPendingChange?.(dirty || busy || runtimePending || activationPending); return () => onPendingChange?.(false); }, [dirty, busy, runtimePending, activationPending, onPendingChange]);
  const discard = () => { hide(); setReplacement(""); if (snapshot) setDraft(fields(snapshot)); setError(undefined); setNotice(undefined); };
  useSettingsDraftRegistration({ dirty, busy, subject: "记忆模型设置", discard });
  const toggle = async () => {
    if (visible || loadingKey) { hide(); return; }
    if (replacement) { setVisible(true); return; }
    if (!bridge || snapshot?.status !== "configured" || draft.endpoint !== snapshot.embedding.endpoint) return;
    const token = ++generation.current; setLoadingKey(true); setError(undefined);
    try {
      const key = await bridge.revealKey({ endpoint: snapshot.embedding.endpoint });
      if (mounted.current && token === generation.current) { setRevealed(key); setVisible(true); }
    } catch { if (mounted.current && token === generation.current) setError("无法显示已保存密钥，请检查系统安全存储后重试。"); }
    finally { if (mounted.current && token === generation.current) setLoadingKey(false); }
  };
  const save = async () => {
    if (!bridge) return;
    const plannerProvider = draft.plannerProvider.trim(), planner = draft.planner.trim();
    if (!plannerProvider !== !planner) {
      setError("召回改写模型需要同时填写 Provider ID 和模型 ID；都留空则关闭召回改写。");
      return;
    }
    hide(); setBusy(true); setError(undefined); setNotice(undefined);
    try {
      const value = await bridge.save({ extraction: { provider: draft.provider, model: draft.extraction },
        ...(planner ? { queryPlanner: { provider: plannerProvider, model: planner } } : {}), embedding: {
        protocol: "openai-compatible", endpoint: draft.endpoint, model: draft.model, dimension: Number(draft.dimension),
        apiKey: replacement ? { action: "replace", value: replacement } : { action: "keep" }
      } });
      if (!mounted.current) return;
      setSnapshot(value); setDraft(fields(value)); setReplacement("");
      setNotice("模型配置已保存，下次服务启动时生效。本次保存没有改变启用设置，也未调用模型。");
    } catch { if (mounted.current) setError("保存失败。请检查完整配置；首次设置或更换地址时需要输入密钥。索引不兼容时仍需单独重建。"); }
    finally { if (mounted.current) setBusy(false); }
  };
  const canReveal = !!replacement || (snapshot?.status === "configured" && draft.endpoint === snapshot.embedding.endpoint);
  return <><LocalMemoryActivationSettings disabled={dirty || busy || runtimePending} onPendingChange={setActivationPending} />
    <LocalMemoryRuntimeSettings onPendingChange={setRuntimePending} disabled={activationPending} />{children}<SettingsSectionBlock title="本地记忆模型" description="模型调用由你配置并付费；保存不会测试连接或启动服务。" actions={dirty || busy ? <div className={styles.bindingActions}>
          <Button className="secondary-button" isDisabled={busy || activationPending} onPress={discard}>撤销修改</Button>
          <Button className="primary-button" isDisabled={busy || activationPending} onPress={() => void save()}>{busy ? "正在保存…" : "保存模型配置"}</Button>
        </div> : undefined}>
    {error ? <SettingsNotice tone="danger">{error}</SettingsNotice> : null}
    {notice ? <SettingsNotice tone="info">{notice}</SettingsNotice> : null}
    {dirty ? <SettingsNotice tone="info">切换页签前，请保存或撤销模型修改。</SettingsNotice> : null}
    {!snapshot ? <SettingsNotice tone="info">正在读取模型配置…</SettingsNotice> : snapshot.status === "unavailable"
      ? <SettingsNotice tone="info">此版本或平台尚未提供本地记忆模型设置。</SettingsNotice> : <>
        <SettingsRows>
          {([
            ["provider", "提取 Provider ID", "使用已有 Pi Provider，不另存其密钥。", undefined],
            ["extraction", "提取模型 ID", "需为 API Key 认证的 OpenAI Chat Completions 模型。", undefined],
            ["plannerProvider", "召回改写 Provider ID（可选）", "与下方模型 ID 同时留空则关闭召回改写。", undefined],
            ["planner", "召回改写模型 ID（可选）", "把追问改写成检索词，通常多等 2–4 秒。",
              "仅在有对话历史时使用。建议选关闭思考的轻量模型，如方舟 doubao-seed-2-0-mini；需在 Pi 模型配置声明 thinkingFormat 才能关闭思考。"],
            ["endpoint", "Embedding 服务地址", "HTTPS 或本机 loopback；更换后需重新输入密钥。", undefined],
            ["model", "Embedding 模型 ID", "更换模型可能需要重建现有索引。", undefined],
            ["dimension", "向量维度", "须与模型输出一致；修改后不会自动迁移索引。", undefined]
          ] as const).map(([name, label, description, info]) => <SettingsRow key={name} description={description}
            title={info ? <>{label}<SettingsInfo label={`${label}说明`}>{info}</SettingsInfo></> : label}
            actions={<Input aria-label={label} className={styles.rowInput!} value={draft[name]} disabled={busy || activationPending}
              inputMode={name === "dimension" ? "numeric" : "text"}
              onChange={(event) => { hide(); setNotice(undefined); setDraft({ ...draft, [name]: event.currentTarget.value }); }} />} />)}
          <SettingsRow description="默认隐藏，离开此页后清除显示。"
            title={<>Embedding API Key<SettingsInfo label="Embedding API Key 说明">点击小眼睛查看；隐藏、切走窗口或离开此页后清除显示用的已保存密钥。</SettingsInfo></>}
            actions={<div className={styles.secretField}>
              <Input aria-label="Embedding API Key" className={styles.rowInput!} type={visible ? "text" : "password"}
                autoComplete="off" spellCheck={false} value={replacement || (visible ? revealed ?? "" : "")}
                placeholder={snapshot.status === "configured" ? "已保存 · 留空保留" : "输入模型 API Key"} disabled={busy || activationPending}
                onChange={(event) => { hide(); setReplacement(event.currentTarget.value); setNotice(undefined); }} />
              <Button className="secondary-button" aria-label={visible || loadingKey ? "隐藏 Embedding API Key" : "显示 Embedding API Key"}
                aria-pressed={visible} isDisabled={busy || activationPending || !canReveal} onPress={() => void toggle()}>
                {visible ? <EyeOff aria-hidden="true" size={14} /> : <Eye aria-hidden="true" size={14} />}
              </Button>
            </div>}>
            {loadingKey ? <span role="status">正在读取密钥…</span> : null}
          </SettingsRow>
        </SettingsRows>

      </>}
  </SettingsSectionBlock></>;
}
