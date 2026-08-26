import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import {
  Button as AriaButton,
  Header,
  ListBox,
  ListBoxItem,
  ListBoxSection,
  Popover,
  Select
} from "react-aria-components";
import styles from "./Composer.module.css";

export interface ComposerRuntimeSelectOption {
  id: string;
  label: string;
  detail?: string;
}

interface ComposerRuntimeSelectOptionGroup {
  id: string;
  label: string;
  options: readonly ComposerRuntimeSelectOption[];
}

interface ComposerRuntimeSelectProps {
  ariaLabel: string;
  disabled: boolean;
  footer?: string;
  icon: ReactNode;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectionChange: (key: string) => void;
  optionGroups?: readonly ComposerRuntimeSelectOptionGroup[];
  options: readonly ComposerRuntimeSelectOption[];
  selectedKey: string | null;
  valueText: string;
  variant: "model" | "thinking";
}

export function ComposerRuntimeSelect({
  ariaLabel,
  disabled,
  footer,
  icon,
  isOpen,
  onOpenChange,
  onSelectionChange,
  optionGroups,
  options,
  selectedKey,
  valueText,
  variant
}: ComposerRuntimeSelectProps) {
  return (
    <Select
      aria-label={ariaLabel}
      isDisabled={disabled}
      isOpen={isOpen}
      selectedKey={selectedKey}
      onOpenChange={onOpenChange}
      onSelectionChange={(key) => {
        if (key !== null) onSelectionChange(String(key));
      }}
    >
      <AriaButton
        className={`${styles.runtimeField} ${styles.runtimeSelectButton}`}
        data-runtime-select={variant}
      >
        {icon}
        <span className={styles.runtimeSelectValue}>{valueText}</span>
        <ChevronDown aria-hidden="true" size={13} />
      </AriaButton>
      <Popover
        className={styles.runtimeSelectPopover!}
        data-runtime-select={variant}
        offset={6}
        placement="top end"
        shouldFlip
      >
        <ComposerRuntimeSelectOptions
          {...(optionGroups === undefined ? {} : { optionGroups })}
          options={options}
          variant={variant}
        />
        {footer ? <small className={styles.runtimeSelectFooter}>{footer}</small> : null}
      </Popover>
    </Select>
  );
}

export function ComposerRuntimeSelectOptions({
  optionGroups,
  options,
  variant
}: Pick<ComposerRuntimeSelectProps, "optionGroups" | "options" | "variant">) {
  return (
    <ListBox className={styles.runtimeSelectList!} data-runtime-select={variant}>
      {optionGroups && optionGroups.length > 0
        ? optionGroups.map((group) => (
            <ListBoxSection className={styles.runtimeSelectSection!} id={group.id} key={group.id}>
              <Header className={styles.runtimeSelectSectionHeader!}>
                <span>{group.label}</span>
                <span aria-label={`${group.options.length} 个模型`}>{group.options.length}</span>
              </Header>
              {group.options.map((option) => <RuntimeSelectOption key={option.id} option={option} variant={variant} />)}
            </ListBoxSection>
          ))
        : options.map((option) => <RuntimeSelectOption key={option.id} option={option} variant={variant} />)}
    </ListBox>
  );
}

function RuntimeSelectOption({
  option,
  variant
}: {
  option: ComposerRuntimeSelectOption;
  variant: ComposerRuntimeSelectProps["variant"];
}) {
  return (
    <ListBoxItem
      className={styles.runtimeSelectOption!}
      data-runtime-select={variant}
      id={option.id}
      textValue={option.label}
    >
      <span className={styles.runtimeSelectOptionCopy}>
        <strong>{option.label}</strong>
        {option.detail ? <small>{option.detail}</small> : null}
      </span>
      <Check aria-hidden="true" className={styles.runtimeSelectCheck} size={14} />
    </ListBoxItem>
  );
}
