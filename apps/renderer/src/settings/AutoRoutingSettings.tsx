import type { PiAutoRoutingSelection, PiDefaultModelSelection, PiProviderConfigurationSnapshot } from "@pi67/protocol";
import { useEffect, useState } from "react";
import { Button } from "react-aria-components";
import { useSettingsDraftRegistration } from "./SettingsDraftGuard.js";
import { SettingsNotice, SettingsRow, SettingsSectionBlock, SettingsSelect } from "./SettingsPrimitives.js";
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
  return <SettingsSectionBlock title="自动模型选择" description="配置后，在对话的模型菜单中选择 Auto。当前默认模型保持不变。">
    <div data-testid="auto-routing-settings">
      {roles.map((role) => {
        const selected = key(draft[role.id]);
        const unavailable = selected !== "" && !choices.some((choice) => choice.id === selected);
        return <SettingsRow key={role.id} title={role.label} description={role.description} actions={
          <SettingsSelect label={`Auto ${role.label}`} value={selected} isDisabled={locked}
            options={[{ id: "", label: "选择已配置的模型", disabled: true },
              ...(unavailable ? [{ id: selected, label: `不可用 · ${draft[role.id]?.provider} / ${draft[role.id]?.model}`, disabled: true }] : []),
              ...choices]}
            onChange={(id) => {
              const choice = choices.find((item) => item.id === id);
              if (choice) setDraft((current) => ({ ...current, [role.id]: choice.selection }));
            }} />
        } />;
      })}
      <div className={styles.notes}>
        <p>每个新任务增加一次判断请求：最多读取任务文本的 16,000 个字符，输出上限 128 tokens，等待上限 10 秒。用量计入会话；工具续接和重试沿用已选模型。</p>
        <p>判断模型只接收当前任务文本。图片交给支持图片的候选模型；团队及共享历史暂不支持 Auto。</p>
      </div>
      {conflict ? <SettingsNotice tone="warning" actions={<Button className="secondary-button" onPress={() => {
        setBaseline(snapshot.autoRouting); setDraft(snapshot.autoRouting ?? {}); setRevision(snapshot.revision);
      }}>采用最新配置</Button>}>配置已更新，请采用最新配置后重新编辑。</SettingsNotice> : null}
      <div className={styles.actions}>
        <Button className="primary-button" isDisabled={locked || !dirty || !complete || conflict}
          onPress={() => void save(draft as PiAutoRoutingSelection)}>保存 Auto 配置</Button>
        {baseline ? <Button className="secondary-button" isDisabled={locked || conflict}
          onPress={() => void save()}>关闭 Auto</Button> : null}
      </div>
      {draft.standard && key(draft.standard) === key(draft.complex)
        ? <SettingsNotice tone="warning">常规任务和复杂任务请选择不同的模型。</SettingsNotice> : null}
    </div>
  </SettingsSectionBlock>;
}

function key(selection?: PiDefaultModelSelection): string {
  return selection ? JSON.stringify([selection.provider, selection.model]) : "";
}
