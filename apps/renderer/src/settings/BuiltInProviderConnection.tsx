import type { PiProviderConfigurationView } from "@pi67/protocol";
import { KeyRound } from "lucide-react";
import { Button } from "react-aria-components";
import styles from "./ProviderConfigurationPanel.module.css";

export function BuiltInProviderConnection({
  provider,
  onConfigureCredential
}: {
  provider: PiProviderConfigurationView;
  onConfigureCredential: () => void;
}) {
  const endpoints = distinctNonEmpty([
    provider.baseUrl,
    ...provider.models.map((model) => model.baseUrl)
  ]);
  const protocols = distinctNonEmpty([
    provider.api,
    ...provider.models.map((model) => model.api)
  ]);
  const credentialSource = builtInCredentialSource(provider);
  const searchConnection = builtInSearchConnection(provider.id);

  return (
    <section className={styles.formSection} data-testid="builtin-provider-connection">
      <header className={styles.sectionIntro}>
        <strong>连接 {provider.name ?? provider.id}</strong>
        <small>Pi 已提供模型、Endpoint 与协议；这里只配置认证，不需要重复填写官方服务地址。</small>
      </header>
      <div className={styles.connectionPrimary} data-configured={provider.configured}>
        <span>
          <strong>{provider.configured ? "认证已可用" : "需要 API Key"}</strong>
          <small>{provider.configured
            ? `${credentialSource}；可以更新保存方式或移除 auth.json 中的凭据。`
            : `配置后即可使用这个服务提供的 ${provider.modelCount} 个模型。`}</small>
        </span>
        <Button
          autoFocus={!provider.configured}
          className={provider.configured ? "secondary-button" : "primary-button"}
          onPress={onConfigureCredential}
        >
          <KeyRound aria-hidden="true" size={14} />
          {provider.configured ? "更新 API Key" : "配置 API Key"}
        </Button>
      </div>
      <dl className={styles.connectionFacts}>
        <div>
          <dt>Provider ID</dt>
          <dd><code>{provider.id}</code></dd>
        </div>
        <div>
          <dt>服务地址（只读）</dt>
          <dd>{endpoints.length > 0
            ? endpoints.map((endpoint) => <code key={endpoint}>{endpoint}</code>)
            : <span>由 Pi 内置 Provider 管理</span>}</dd>
        </div>
        <div>
          <dt>API 协议（只读）</dt>
          <dd>{protocols.length > 0
            ? protocols.map((protocol) => <code key={protocol}>{protocol}</code>)
            : <span>由 Pi 内置 Provider 管理</span>}</dd>
        </div>
        <div>
          <dt>凭据保存</dt>
          <dd><span>推荐写入 Pi auth.json，重启后仍可用；仅本次使用则在完全退出后失效</span></dd>
        </div>
        {searchConnection ? <div>
          <dt>原生搜索</dt>
          <dd><span>{searchConnection}</span></dd>
        </div> : null}
      </dl>
      <div className={styles.readOnlyNotice}>
        内置服务不开放 URL、协议、Headers 或高级 JSON 编辑，避免把 Pi 内置目录复制成一份容易漂移的私有配置。
        如需代理地址或兼容服务，请返回列表，在“自定义”中新建独立模型服务。
      </div>
    </section>
  );
}

function distinctNonEmpty(values: ReadonlyArray<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function builtInCredentialSource(provider: PiProviderConfigurationView): string {
  if (provider.credentialSource === "runtime") return "当前使用运行内存中的 API Key，完全退出后失效";
  if (provider.credentialSource === "stored") return "凭据已保存到 Pi auth.json";
  if (provider.credentialSource === "environment") return "凭据来自环境配置";
  if (provider.credentialSource === "models_json_key") return "凭据来自 Pi models.json";
  if (provider.credentialSource === "models_json_command") return "凭据由 Pi models.json 命令提供";
  if (provider.credentialSource === "fallback") return "凭据来自 Provider 默认认证";
  return "Pi 已解析当前认证";
}

function builtInSearchConnection(providerId: string): string | undefined {
  if (providerId !== "deepseek") return undefined;
  return "DeepSeek V4 Flash 通过官方 Responses /responses 自动联网搜索，并与对话共用这个 API Key；V4 Pro 暂未声明此能力";
}
