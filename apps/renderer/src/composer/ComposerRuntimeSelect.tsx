import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import {
  Button as AriaButton,
  ListBox,
  ListBoxItem,
  Popover,
  Select
} from "react-aria-components";
import styles from "./Composer.module.css";

export interface ComposerRuntimeSelectOption {
  id: string;
  label: string;
  detail?: string;
}

interface ComposerRuntimeSelectProps {
  ariaLabel: string;
  disabled: boolean;
  footer?: string;
  icon: ReactNode;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectionChange: (key: string) => void;
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
        <ListBox
          className={styles.runtimeSelectList!}
          data-runtime-select={variant}
        >
          {options.map((option) => (
            <ListBoxItem
              className={styles.runtimeSelectOption!}
              data-runtime-select={variant}
              id={option.id}
              key={option.id}
              textValue={option.label}
            >
              <span className={styles.runtimeSelectOptionCopy}>
                <strong>{option.label}</strong>
                {option.detail ? <small>{option.detail}</small> : null}
              </span>
              <Check aria-hidden="true" className={styles.runtimeSelectCheck} size={14} />
            </ListBoxItem>
          ))}
        </ListBox>
        {footer ? <small className={styles.runtimeSelectFooter}>{footer}</small> : null}
      </Popover>
    </Select>
  );
}
