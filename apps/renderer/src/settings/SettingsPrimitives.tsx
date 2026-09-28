import { ArrowLeft, Check, ChevronDown, Info } from "lucide-react";
import { useState, type ReactNode, type SyntheticEvent } from "react";
import {
  Button,
  Checkbox,
  ListBox,
  ListBoxItem,
  Popover,
  Select,
  SelectValue,
  Tooltip,
  TooltipTrigger
} from "react-aria-components";
import styles from "./SettingsPrimitives.module.css";

export function SettingsPageHeader({ title, description, actions }: {
  title: ReactNode;
  description: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className={styles.pageHeader}>
      <span className={styles.pageHeading}>
        <h1 tabIndex={-1}>{title}</h1>
        <p>{description}</p>
      </span>
      {actions ? <div className={styles.pageActions}>{actions}</div> : null}
    </header>
  );
}

export function SettingsSectionBlock({ title, description, actions, children, className }: {
  title: string;
  /** Only when it changes a decision; boundary explanations belong in `SettingsInfo`. */
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`${styles.section} ${className ?? ""}`}>
      <header className={styles.sectionHeader}>
        <span><h2>{title}</h2>{description ? <p>{description}</p> : null}</span>
        {actions ? <div className={styles.sectionActions}>{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function SettingsRows({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`${styles.rows} ${className ?? ""}`}>{children}</div>;
}

/** Row anatomy: title + at most one hint line, then value/status and actions. Rows never carry a leading icon. */
export function SettingsRow({ title, description, value, actions, children, className }: {
  title: ReactNode;
  description?: ReactNode;
  value?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`${styles.row} ${className ?? ""}`}>
      <span className={styles.identity}>
        <strong>{title}</strong>
        {description ? <small>{description}</small> : null}
        {children}
      </span>
      {value ? <span className={styles.value}>{value}</span> : null}
      {actions ? <div className={styles.rowActions}>{actions}</div> : null}
    </div>
  );
}

export type SettingsStatusTone = "neutral" | "success" | "warning" | "danger";

/** The single status language for Settings: a dot plus a short label. */
export function SettingsStatus({ tone, children }: { tone: SettingsStatusTone; children: ReactNode }) {
  return <span className={styles.status} data-tone={tone}><span aria-hidden="true" className={styles.statusDot} />{children}</span>;
}

/** Boundary or privacy explanation revealed on demand instead of a permanent paragraph. */
export function SettingsInfo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <TooltipTrigger delay={250}>
      <Button aria-label={label} className={styles.infoButton!}><Info aria-hidden="true" size={13} /></Button>
      <Tooltip className={styles.infoTooltip!} offset={6}>{children}</Tooltip>
    </TooltipTrigger>
  );
}

/** Secondary page or row action shown as an icon; the label is its accessible name and tooltip. */
export function SettingsIconAction({ label, icon, onPress, isDisabled = false }: {
  label: string;
  icon: ReactNode;
  onPress: () => void;
  isDisabled?: boolean;
}) {
  return (
    <TooltipTrigger delay={400}>
      <Button aria-label={label} className={styles.iconAction!} isDisabled={isDisabled} onPress={onPress}>{icon}</Button>
      <Tooltip className={styles.infoTooltip!} offset={6}>{label}</Tooltip>
    </TooltipTrigger>
  );
}

export interface SettingsSelectOption<T extends string> {
  id: T;
  label: string;
  /** Shown for truthfulness (e.g. an unavailable saved value) but not selectable. */
  disabled?: boolean;
}

/** Non-native single choice; the trigger is a button named by `label`, options have role "option". */
export function SettingsSelect<T extends string>({ label, value, options, onChange, isDisabled = false, testId }: {
  label: string;
  value: T;
  options: readonly SettingsSelectOption<T>[];
  onChange: (value: T) => void;
  isDisabled?: boolean;
  testId?: string;
}) {
  return (
    <Select
      aria-label={label}
      className={styles.select!}
      disabledKeys={options.filter((option) => option.disabled).map((option) => option.id)}
      isDisabled={isDisabled}
      selectedKey={value}
      onSelectionChange={(key) => { if (key !== null) onChange(String(key) as T); }}
    >
      <Button aria-label={label} className={styles.selectTrigger!} data-testid={testId}>
        <SelectValue className={styles.selectValue!} />
        <ChevronDown aria-hidden="true" size={14} />
      </Button>
      <Popover className={styles.selectPopover!} offset={4} placement="bottom start" shouldFlip>
        <ListBox aria-label={label} className={styles.selectList!}>
          {options.map((option) => (
            <ListBoxItem className={styles.selectOption!} id={option.id} key={option.id} textValue={option.label}>
              <span>{option.label}</span>
              <Check aria-hidden="true" className={styles.selectCheck} size={14} />
            </ListBoxItem>
          ))}
        </ListBox>
      </Popover>
    </Select>
  );
}

export function SettingsCheckbox({ children, isSelected, onChange, isDisabled = false }: {
  children: ReactNode;
  isSelected: boolean;
  onChange: (selected: boolean) => void;
  isDisabled?: boolean;
}) {
  return (
    <Checkbox className={styles.checkbox!} isDisabled={isDisabled} isSelected={isSelected} onChange={onChange}>
      <span aria-hidden="true" className={styles.checkboxBox}><Check size={11} strokeWidth={3} /></span>
      {children}
    </Checkbox>
  );
}

/** Appears only while a draft differs from saved state; replaces permanently disabled header save buttons. */
export function SettingsSaveBar({ dirty, saving, canSave, onSave, onDiscard, saveLabel = "保存更改" }: {
  dirty: boolean;
  saving: boolean;
  canSave: boolean;
  onSave: () => void;
  onDiscard: () => void;
  saveLabel?: string;
}) {
  if (!dirty && !saving) return null;
  return (
    <div aria-label="未保存的更改" className={styles.saveBar} role="region">
      <span>{saving ? "正在保存…" : "有未保存的更改"}</span>
      <Button className={styles.saveBarDiscard!} isDisabled={saving} onPress={onDiscard}>放弃</Button>
      <Button className="primary-button" isDisabled={!canSave || saving} onPress={onSave}>{saving ? "保存中…" : saveLabel}</Button>
    </div>
  );
}

/** Empty or not-yet-available content shown in place of rows, inside the same card. */
export function SettingsEmpty({ children }: { children: ReactNode }) {
  return <div className={styles.empty} role="status">{children}</div>;
}

export function SettingsCatalog({ children, className, label }: {
  children: ReactNode;
  className?: string;
  label: string;
}) {
  return <div aria-label={label} className={`${styles.catalog} ${className ?? ""}`} role="list">{children}</div>;
}

/** Catalog entry: same anatomy as SettingsRow (no leading icon); status belongs in `trailing`. */
export function SettingsCatalogRow({
  title,
  description,
  meta,
  trailing,
  actions,
  selected = false,
  testId,
  onSelect
}: {
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  actions?: ReactNode;
  selected?: boolean;
  testId?: string;
  onSelect: () => void;
}) {
  return (
    <div className={styles.catalogItem} data-actions={actions ? true : undefined} role="listitem">
      <button
        aria-pressed={selected}
        className={styles.catalogRow}
        data-testid={testId}
        onClick={onSelect}
        type="button"
      >
        <span className={styles.catalogIdentity}>
          <strong>{title}</strong>
          {description ? <small>{description}</small> : null}
          {meta ? <span className={styles.catalogMeta}>{meta}</span> : null}
        </span>
        {trailing ? <span className={styles.catalogTrailing}>{trailing}</span> : null}
      </button>
      {actions ? <div className={styles.catalogActions}>{actions}</div> : null}
    </div>
  );
}

export function SettingsBackAction({ children, label, onPress }: {
  children: ReactNode;
  label: string;
  onPress: () => void;
}) {
  return (
    <Button aria-label={label} className={styles.backAction!} onPress={onPress}>
      <ArrowLeft aria-hidden="true" size={15} />
      {children}
    </Button>
  );
}

/** Header of a drill-in detail: back link, one title scale, one metadata line, then status and actions. */
export function SettingsDetailHeader({ back, title, meta, detail, status, actions }: {
  back: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  /** Optional second line for an identifier such as a file path. */
  detail?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className={styles.detailHeader}>
      {back}
      <div className={styles.detailHeading}>
        <span className={styles.detailIdentity}>
          <h2>{title}</h2>
          {meta ? <span className={styles.detailMeta}>{meta}</span> : null}
          {detail ? <span className={styles.detailMeta}>{detail}</span> : null}
        </span>
        {status || actions ? <span className={styles.detailActions}>{status}{actions}</span> : null}
      </div>
    </header>
  );
}

export function SettingsToolbar({ status, actions, className }: {
  status: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`${styles.toolbar} ${className ?? ""}`}>
      <div className={styles.toolbarStatus}>{status}</div>
      {actions ? <div className={styles.toolbarActions}>{actions}</div> : null}
    </div>
  );
}

export function SettingsNotice({ tone = "info", children, actions, className, testId }: {
  tone?: "info" | "warning" | "danger";
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div
      className={`${styles.notice} ${className ?? ""}`}
      data-testid={testId}
      data-tone={tone}
      role={tone === "danger" ? "alert" : "status"}
    >
      <span>{children}</span>
      {actions ? <div className={styles.noticeActions}>{actions}</div> : null}
    </div>
  );
}

/** Disclosure state that cannot collapse while dirty or erroneous content requires it open. */
export function useRequiredOpenDisclosure(requiredOpen: boolean) {
  const [expanded, setExpanded] = useState(false);
  return {
    open: requiredOpen || expanded,
    onToggle: (event: SyntheticEvent<HTMLDetailsElement>) => {
      if (requiredOpen && !event.currentTarget.open) event.currentTarget.open = true;
      else setExpanded(event.currentTarget.open);
    }
  };
}

export function SettingsDetails({ title, summary, requiredOpen = false, children }: {
  title: string; summary?: string; requiredOpen?: boolean; children: ReactNode;
}) {
  const disclosure = useRequiredOpenDisclosure(requiredOpen);
  return <details className={styles.details} {...disclosure}>
    <summary><strong>{title}</strong>{summary ? <span>{summary}</span> : null}</summary>
    <div className={styles.detailsContent}>{children}</div>
  </details>;
}
