import type { PiAutoRoutingSelection, PiDefaultModelSelection, PiProviderConfigurationSnapshot } from "@pi67/protocol";
import { useEffect, useState } from "react";
import { Button } from "react-aria-components";
import { useSettingsDraftRegistration } from "./SettingsDraftGuard.js";
import { ProviderBrandIcon } from "./ProviderBrandIcon.js";
import { SettingsInfo, SettingsNotice, SettingsRow, SettingsRows, SettingsSectionBlock, SettingsSelect } from "./SettingsPrimitives.js";
import { setGlobalAutoRoutingConfiguration } from "./provider-configuration-controller.js";
import styles from "./AutoRoutingSettings.module.css";

const roles = [
  { id: "judge", label: "判断模型", description: "判断任务复杂度，建议选择响应快、费用低的模型。" },
  { id: "standard", label: "常规任务", description: "用于问答、摘要、提取和小范围修改。" },
  { id: "complex", label: "复杂任务", description: "用于设计、疑难排查和多步骤工作。" }
] as const;
type Draft = Partial<PiAutoRoutingSelection>;

export function AutoRoutingSettings({ snapshot, disabled = false }: { snapshot: PiProviderConfigurationSnapshot; disabled?: boolean }) {
  const [baseline, setBaseline] = useState(snapshot.autoRouting);
  const [revision, setRevision] = useState(snapshot.revision);
  const [draft, setDraft] = useState<Draft>(snapshot.autoRouting ?? {});
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline ?? {});
  const conflict = dirty && revision !== snapshot.revision;
  useEffect(() => {
    if (!dirty) {
      setBaseline(snapshot.autoRouting);
      setDraft(snapshot.autoRouting ?? {});
      setRevision(snapshot.revision);
    }
  }, [snapshot.autoRouting, snapshot.revision, dirty]);
  useSettingsDraftRegistration({ dirty, busy: saving, subject: "自动模型选择", discard: () => {
    setBaseline(snapshot.autoRouting); setDraft(snapshot.autoRouting ?? {}); setRevision(snapshot.revision);
  } });
  const choices = snapshot.providers.filter((provider) => provider.configured).flatMap((provider) => (
    provider.models.filter((model) => model.api !== "pi-virtual" && model.input.includes("text"))
      .map((model) => ({ id: key({ provider: provider.id, model: model.id }),
        label: `${provider.name ?? provider.id} / ${model.name ?? model.id}`,
        leading: <ProviderBrandIcon hints={[model.id, model.name, provider.id, provider.name]}
          label={model.name ?? model.id} size="inline" />,
        selection: { provider: provider.id, model: model.id } }))
  ));
  const complete = roles.every((role) => choices.some((choice) => choice.id === key(draft[role.id])))
    && key(draft.standard) !== key(draft.complex);
  const locked = disabled || saving || snapshot.syncState !== "current";
  async function save(selection?: PiAutoRoutingSelection) {
    setSaving(true);
    const submitted = JSON.stringify(draft);
    try {
      if (await setGlobalAutoRoutingConfiguration(revision, selection)) {
        setBaseline(selection);
        // Controls are locked during save; keep this guard for external updates.
        setDraft((current) => JSON.stringify(current) === submitted ? selection ?? {} : current);
      }
    } finally { setSaving(false); }
  }
  return <SettingsSectionBlock title="自动模型选择" description="配置后，在对话的模型菜单中选择 Auto。当前默认模型保持不变。"
    actions={baseline ? <Button className="secondary-button" isDisabled={locked || conflict}
      onPress={() => void save()}>关闭 Auto</Button> : undefined}>
    <div className={styles.form} data-testid="auto-routing-settings">
      <SettingsRows>
      {roles.map((role) => {
        const selected = key(draft[role.id]);
        const unavailable = selected !== "" && !choices.some((choice) => choice.id === selected);
        return <SettingsRow key={role.id} title={role.label} description={role.description} actions={
          <SettingsSelect className={styles.modelSelect!} label={`Auto ${role.label}`} value={selected} isDisabled={locked}
            options={[{ id: "", label: "选择已配置的模型", disabled: true },
              ...(unavailable ? [{ id: selected, label: `不可用 · ${draft[role.id]?.provider} / ${draft[role.id]?.model}`, disabled: true }] : []),
              ...choices]}
            onChange={(id) => {
              const choice = choices.find((item) => item.id === id);
              if (choice) setDraft((current) => ({ ...current, [role.id]: choice.selection }));
            }} />
        } />;
      })}
      </SettingsRows>
      <p className={styles.note}>
        每个新任务会额外发起一次判断请求，用量计入会话。
        <SettingsInfo label="Auto 判断请求的范围与限制">
          最多读取任务文本的 16,000 个字符，输出上限 128 tokens，等待上限 10 秒；工具续接和重试沿用已选模型。判断模型只接收当前任务文本。图片交给支持图片的候选模型；团队及共享历史暂不支持 Auto。
        </SettingsInfo>
      </p>
      {conflict ? <SettingsNotice tone="warning" actions={<Button className="secondary-button" onPress={() => {
        setBaseline(snapshot.autoRouting); setDraft(snapshot.autoRouting ?? {}); setRevision(snapshot.revision);
      }}>采用最新配置</Button>}>配置已更新，请采用最新配置后重新编辑。</SettingsNotice> : null}
      {/* Save exists only for a draft, so an idle form never shows a dimmed primary action. */}
      {dirty ? <div className={styles.actions}>
        <Button className="primary-button" isDisabled={locked || !complete || conflict}
          onPress={() => void save(draft as PiAutoRoutingSelection)}>保存 Auto 配置</Button>
      </div> : null}
      {draft.standard && key(draft.standard) === key(draft.complex)
        ? <SettingsNotice tone="warning">常规任务和复杂任务请选择不同的模型。</SettingsNotice> : null}
    </div>
  </SettingsSectionBlock>;
}

function key(selection?: PiDefaultModelSelection): string {
  return selection ? JSON.stringify([selection.provider, selection.model]) : "";
}
