import type {
  PiProviderDiscoveredModel,
  PiProviderDiscoveryProtocolFamily,
  PiProviderModelDiscoveryResult,
  PiProviderConfigurationInput
} from "@pi67/protocol";
import { Check, Eye, EyeOff, LoaderCircle, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Checkbox,
  CheckboxGroup,
  Input,
  Label,
  Radio,
  RadioGroup
} from "react-aria-components";
import {
  cancelProviderModelDiscovery,
  inspectProviderModelDiscovery
} from "./provider-configuration-controller.js";
import { useProviderConfigurationStore } from "./provider-configuration-store.js";
import styles from "./ProviderModelDiscovery.module.css";

const PROTOCOLS: Array<{
  id: PiProviderDiscoveryProtocolFamily;
  label: string;
  detail: string;
}> = [
  {
    id: "openai",
    label: "OpenAI 兼容",
    detail: "GPT 与其他 OpenAI-compatible 模型；新导入模型优先使用 Responses"
  },
  {
    id: "anthropic",
    label: "Anthropic Messages",
    detail: "Claude 系列模型，使用 anthropic-messages"
  },
  {
    id: "gemini",
    label: "Google Gemini",
    detail: "Gemini 系列模型，使用 google-generative-ai"
  }
];
export const DEFAULT_PROVIDER_DISCOVERY_PROTOCOLS: PiProviderDiscoveryProtocolFamily[] = [
  "openai",
  "anthropic",
  "gemini"
];
export const DEFAULT_PROVIDER_DISCOVERY_OPENAI_API = "openai-responses" as const;

export function ProviderModelDiscovery({
  apiKey,
  draft,
  hasStoredCredential,
  onApiKeyChange
}: {
  apiKey: string;
  draft: PiProviderConfigurationInput;
  hasStoredCredential: boolean;
  onApiKeyChange: (value: string) => void;
}) {
  const [protocols, setProtocols] = useState<PiProviderDiscoveryProtocolFamily[]>(
    DEFAULT_PROVIDER_DISCOVERY_PROTOCOLS
  );
  const [openAiApi, setOpenAiApi] = useState<"openai-responses" | "openai-completions">(
    DEFAULT_PROVIDER_DISCOVERY_OPENAI_API
  );
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [result, setResult] = useState<PiProviderModelDiscoveryResult>();
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [appliedCount, setAppliedCount] = useState<number>();
  const requestRef = useRef(0);

  useEffect(() => {
    requestRef.current += 1;
    setPending(false);
    setResult(undefined);
    setSelectedModels([]);
    setError(undefined);
    setAppliedCount(undefined);
    return () => {
      requestRef.current += 1;
      void cancelProviderModelDiscovery();
    };
  }, [apiKey, draft.baseUrl, draft.id, openAiApi, protocols]);

  const selectedSet = useMemo(() => new Set(selectedModels), [selectedModels]);
  const discover = () => {
    if (!draft.id.trim() || !draft.baseUrl?.trim() || protocols.length === 0 || pending) return;
    const request = requestRef.current + 1;
    requestRef.current = request;
    setPending(true);
    setError(undefined);
    setAppliedCount(undefined);
    void inspectProviderModelDiscovery({
      provider: draft.id.trim(),
      baseUrl: draft.baseUrl.trim(),
      protocols,
      openAiApi,
      authHeader: draft.authHeader !== false,
      ...(apiKey.length > 0 ? { apiKey } : {})
    }).then((next) => {
      if (requestRef.current !== request) return;
      setResult(next);
      setSelectedModels(next.models.map(modelSelectionKey));
    }, (reason: unknown) => {
      if (requestRef.current !== request) return;
      setError(reason instanceof Error ? reason.message : "模型目录检测失败。");
    }).finally(() => {
      if (requestRef.current === request) setPending(false);
    });
  };
  const cancel = () => {
    requestRef.current += 1;
    setPending(false);
    void cancelProviderModelDiscovery();
  };
  const applySelection = () => {
    if (!result) return;
    const selected = result.models.filter((model) => selectedSet.has(modelSelectionKey(model)));
    const nextModels = mergeDiscoveredModels(draft.models, selected);
    const additions = nextModels.length - draft.models.length;
    useProviderConfigurationStore.getState().updateDraft((current) => ({
      ...current,
      ...(current.authHeader === undefined ? { authHeader: true } : {}),
      models: mergeDiscoveredModels(current.models, selected)
    }));
    setAppliedCount(additions);
  };

  const canDiscover = Boolean(draft.id.trim() && draft.baseUrl?.trim() && protocols.length > 0 && !pending);
  return (
    <section className={styles.discovery} data-testid="provider-model-discovery">
      <header className={styles.heading}>
        <span>
          <strong>协议与模型发现</strong>
          <small>同一组 Base URL 与 API Key 可发现多个协议族；检测只读取模型目录，不发送生成请求。</small>
        </span>
        <Button
          className="secondary-button"
          isDisabled={!pending && !canDiscover}
          onPress={pending ? cancel : discover}
        >
          {pending
            ? <><X aria-hidden="true" size={14} />取消检测</>
            : <><Search aria-hidden="true" size={14} />检测并加载模型</>}
        </Button>
      </header>

      <div className={styles.credentialField}>
        <Label htmlFor="provider-discovery-api-key">API Key</Label>
        <div className={styles.secretInput}>
          <Input
            autoComplete="new-password"
            id="provider-discovery-api-key"
            placeholder={hasStoredCredential ? "留空则使用已保存的 Pi API Key" : "输入用于检测和保存的 API Key"}
            type={apiKeyVisible ? "text" : "password"}
            value={apiKey}
            onChange={(event) => onApiKeyChange(event.target.value)}
          />
          <Button
            aria-label={apiKeyVisible ? "隐藏 API Key" : "显示 API Key"}
            aria-pressed={apiKeyVisible}
            isDisabled={apiKey.length === 0}
            onPress={() => setApiKeyVisible((visible) => !visible)}
          >
            {apiKeyVisible ? <EyeOff aria-hidden="true" size={14} /> : <Eye aria-hidden="true" size={14} />}
          </Button>
        </div>
        <small>{hasStoredCredential && apiKey.length === 0
          ? "检测会在 Agent Host 内使用 auth.json 中的凭据；完整 Key 不返回 Renderer。"
          : "当前输入只保留在这个未保存草稿中；保存 Provider 时再写入 Pi auth.json。"}</small>
      </div>

      <CheckboxGroup
        aria-label="要发现的协议"
        className={styles.protocolGroup!}
        value={protocols}
        onChange={(values) => setProtocols(values as PiProviderDiscoveryProtocolFamily[])}
      >
        <Label>要发现的协议 <small>默认全部启用</small></Label>
        <div className={styles.protocolOptions}>
          {PROTOCOLS.map((protocol) => (
            <Checkbox className={styles.protocolOption!} key={protocol.id} value={protocol.id}>
              <span className={styles.checkIndicator}><Check aria-hidden="true" size={12} /></span>
              <span><strong>{protocol.label}</strong><small>{protocol.detail}</small></span>
            </Checkbox>
          ))}
        </div>
      </CheckboxGroup>

      {protocols.includes("openai") ? (
        <details className={styles.openAiDetails}>
          <summary>OpenAI 兼容策略 · {openAiApi === "openai-responses" ? "Responses 优先" : "Chat Completions"}</summary>
          <RadioGroup
            aria-label="OpenAI 新导入模型协议"
            className={styles.openAiChoices!}
            value={openAiApi}
            onChange={(value) => setOpenAiApi(value as typeof openAiApi)}
          >
            <Radio value="openai-responses">
              <span className={styles.radioIndicator} />
              <span><strong>OpenAI Responses</strong><small>推荐；新导入的 OpenAI-compatible 模型默认使用</small></span>
            </Radio>
            <Radio value="openai-completions">
              <span className={styles.radioIndicator} />
              <span><strong>OpenAI Chat Completions</strong><small>仅在网关不支持 Responses 时选择</small></span>
            </Radio>
          </RadioGroup>
        </details>
      ) : null}

      {pending ? (
        <div className={styles.pending} role="status">
          <LoaderCircle aria-hidden="true" size={15} />正在通过已选协议读取模型目录…
        </div>
      ) : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {result ? (
        <DiscoveryResult
          result={result}
          selectedModels={selectedModels}
          onApply={applySelection}
          onSelectedModelsChange={setSelectedModels}
        />
      ) : null}
      {appliedCount !== undefined ? (
        <p className={styles.applied} role="status">
          {appliedCount > 0
            ? `已把 ${appliedCount} 个新模型加入当前草稿；保存后写入 Pi models.json。`
            : "所选模型已存在，当前草稿没有重复添加。"}
        </p>
      ) : null}
    </section>
  );
}

function DiscoveryResult({
  result,
  selectedModels,
  onApply,
  onSelectedModelsChange
}: {
  result: PiProviderModelDiscoveryResult;
  selectedModels: string[];
  onApply: () => void;
  onSelectedModelsChange: (models: string[]) => void;
}) {
  const selected = new Set(selectedModels);
  return (
    <section className={styles.results} aria-label="发现结果">
      <header>
        <span>
          <strong>发现结果 · {result.models.length} 个模型</strong>
          <small>{selectedModels.length} 个准备加入草稿；目录发现不代表真实生成请求已成功。</small>
        </span>
        <Button className="secondary-button" isDisabled={selectedModels.length === 0} onPress={onApply}>
          添加所选模型到草稿
        </Button>
      </header>
      {result.families.map((family) => {
        const models = result.models.filter((model) => model.protocol === family.protocol);
        const keys = models.map(modelSelectionKey);
        const selectedCount = keys.filter((key) => selected.has(key)).length;
        return (
          <section className={styles.resultGroup} key={family.protocol}>
            <Checkbox
              className={styles.groupSelector!}
              isDisabled={keys.length === 0}
              isIndeterminate={selectedCount > 0 && selectedCount < keys.length}
              isSelected={keys.length > 0 && selectedCount === keys.length}
              onChange={(checked) => onSelectedModelsChange(checked
                ? [...new Set([...selectedModels, ...keys])]
                : selectedModels.filter((key) => !keys.includes(key)))}
            >
              <span className={styles.checkIndicator}><Check aria-hidden="true" size={12} /></span>
              <span>
                <strong>{protocolLabel(family.protocol)} · {family.modelCount}</strong>
                <small>{familyStatusLabel(family.status)}{family.message ? ` · ${family.message}` : ""}</small>
              </span>
            </Checkbox>
            {models.length > 0 ? (
              <div className={styles.modelOptions}>
                {models.map((model) => {
                  const key = modelSelectionKey(model);
                  return (
                    <Checkbox
                      className={styles.modelOption!}
                      isSelected={selected.has(key)}
                      key={key}
                      onChange={(checked) => onSelectedModelsChange(checked
                        ? [...selectedModels, key]
                        : selectedModels.filter((candidate) => candidate !== key))}
                    >
                      <span className={styles.checkIndicator}><Check aria-hidden="true" size={11} /></span>
                      <span>
                        <strong>{model.name ?? model.id}</strong>
                        <small>{model.id}{model.supplier ? ` · ${model.supplier}` : ""} · {model.api}</small>
                      </span>
                    </Checkbox>
                  );
                })}
              </div>
            ) : null}
          </section>
        );
      })}
      {result.conflicts.length > 0 ? (
        <div className={styles.conflicts} role="alert">
          <strong>{result.conflicts.length} 个模型身份冲突，未加入候选</strong>
          {result.conflicts.map((conflict) => (
            <small key={conflict.id}><code>{conflict.id}</code> 同时来自 {conflict.suppliers.join("、")}；请让网关提供不同的可路由 Model ID。</small>
          ))}
        </div>
      ) : null}
      {result.truncated ? <p className={styles.warning}>目录超过安全上限，只显示前 512 个可用模型或前 128 个冲突。</p> : null}
    </section>
  );
}

export function mergeDiscoveredModels(
  current: PiProviderConfigurationInput["models"],
  discovered: PiProviderDiscoveredModel[]
): PiProviderConfigurationInput["models"] {
  const existingIds = new Set(current.map((model) => model.id));
  return [
    ...current,
    ...discovered
      .filter((model) => !existingIds.has(model.id))
      .map(discoveredModelInput)
  ];
}

function discoveredModelInput(model: PiProviderDiscoveredModel) {
  return {
    id: model.id,
    ...(model.name ? { name: model.name } : {}),
    api: model.api,
    input: ["text" as const],
    reasoning: false,
    advancedJson: "{}"
  };
}

function modelSelectionKey(model: PiProviderDiscoveredModel): string {
  return `${model.protocol}\u0000${model.id}`;
}

function protocolLabel(protocol: PiProviderDiscoveryProtocolFamily): string {
  if (protocol === "anthropic") return "Anthropic Messages";
  if (protocol === "gemini") return "Google Gemini";
  return "OpenAI 兼容";
}

function familyStatusLabel(status: PiProviderModelDiscoveryResult["families"][number]["status"]): string {
  if (status === "current") return "目录已读取";
  if (status === "shared") return "来自共享目录";
  if (status === "empty") return "没有识别到模型";
  return "读取失败";
}
