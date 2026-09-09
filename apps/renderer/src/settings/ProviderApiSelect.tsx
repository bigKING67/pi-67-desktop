import { Check, ChevronDown } from "lucide-react";
import {
  Button,
  Header,
  ListBox,
  ListBoxItem,
  ListBoxSection,
  Popover,
  Select,
  SelectValue
} from "react-aria-components";
import styles from "./ProviderApiSelect.module.css";

export const PI_MODELS_JSON_API_OPTIONS = [
  {
    id: "openai-responses",
    label: "OpenAI Responses",
    detail: "Responses API 与兼容网关"
  },
  {
    id: "openai-completions",
    label: "OpenAI Chat Completions",
    detail: "Ollama、vLLM、LM Studio 与多数兼容服务"
  },
  {
    id: "anthropic-messages",
    label: "Anthropic Messages",
    detail: "Claude Messages API 与兼容网关"
  },
  {
    id: "google-generative-ai",
    label: "Google Gemini",
    detail: "Google AI Studio / Gemini API"
  }
] as const;

const API_KEY_PREFIX = "api:";
const UNSET_API_KEY = "resolution:unset";

export function ProviderApiSelect({
  ariaLabel,
  disabled = false,
  onChange,
  unsetDetail,
  unsetLabel,
  value
}: {
  ariaLabel: string;
  disabled?: boolean;
  onChange: (value: string | undefined) => void;
  unsetDetail: string;
  unsetLabel: string;
  value: string | undefined;
}) {
  const selectedKey = value ? apiKey(value) : UNSET_API_KEY;
  return (
    <Select
      aria-label={ariaLabel}
      className={styles.select!}
      isDisabled={disabled}
      onSelectionChange={(key) => onChange(apiFromSelectionKey(key === null ? null : String(key)))}
      selectedKey={selectedKey}
    >
      <Button aria-label={ariaLabel} className={styles.trigger!}>
        <SelectValue>{apiValueLabel(value, unsetLabel)}</SelectValue>
        <ChevronDown aria-hidden="true" size={14} />
      </Button>
      <Popover className={styles.popover!} offset={5} placement="bottom start" shouldFlip>
        <ProviderApiSelectOptions
          currentValue={value}
          unsetDetail={unsetDetail}
          unsetLabel={unsetLabel}
        />
      </Popover>
    </Select>
  );
}

export function ProviderApiSelectOptions({
  currentValue,
  unsetDetail,
  unsetLabel
}: {
  currentValue: string | undefined;
  unsetDetail: string;
  unsetLabel: string;
}) {
  const customValue = currentValue && !knownApiOption(currentValue) ? currentValue : undefined;
  return (
    <ListBox aria-label="API 协议选项" className={styles.list!}>
      <ListBoxSection className={styles.section!} id="resolution">
        <Header className={styles.sectionHeader!}>默认方式</Header>
        <ApiOption detail={unsetDetail} id={UNSET_API_KEY} label={unsetLabel} />
      </ListBoxSection>
      <ListBoxSection className={styles.section!} id="pi-supported-apis">
        <Header className={styles.sectionHeader!}>Pi models.json 支持</Header>
        {PI_MODELS_JSON_API_OPTIONS.map((option) => (
          <ApiOption detail={option.detail} id={apiKey(option.id)} key={option.id} label={option.label} value={option.id} />
        ))}
      </ListBoxSection>
      {customValue ? (
        <ListBoxSection className={styles.section!} id="current-custom-api">
          <Header className={styles.sectionHeader!}>当前配置</Header>
          <ApiOption
            detail="由现有 Pi Provider 或 Extension 注册；保持原值"
            id={apiKey(customValue)}
            label="自定义协议"
            value={customValue}
          />
        </ListBoxSection>
      ) : null}
    </ListBox>
  );
}

export function apiFromSelectionKey(key: string | null): string | undefined {
  if (key === null || key === UNSET_API_KEY || !key.startsWith(API_KEY_PREFIX)) return undefined;
  return key.slice(API_KEY_PREFIX.length);
}

export function apiValueLabel(value: string | undefined, unsetLabel: string): string {
  if (!value) return unsetLabel;
  const option = knownApiOption(value);
  return option ? `${option.label} · ${option.id}` : `自定义协议 · ${value}`;
}

function ApiOption({ id, label, detail, value }: {
  id: string;
  label: string;
  detail: string;
  value?: string;
}) {
  return (
    <ListBoxItem className={styles.option!} id={id} textValue={value ? `${label} ${value}` : label}>
      <span>
        <strong>{label}</strong>
        <small>{value ?? detail}</small>
        {value ? <em>{detail}</em> : null}
      </span>
      <Check aria-hidden="true" className={styles.check} size={14} />
    </ListBoxItem>
  );
}

function knownApiOption(value: string) {
  return PI_MODELS_JSON_API_OPTIONS.find((option) => option.id === value);
}

function apiKey(value: string): string {
  return `${API_KEY_PREFIX}${value}`;
}
