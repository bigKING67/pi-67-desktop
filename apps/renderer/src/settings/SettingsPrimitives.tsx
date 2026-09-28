import { ArrowLeft, Info } from "lucide-react";
import { useState, type ReactNode, type SyntheticEvent } from "react";
import { Button, Tooltip, TooltipTrigger } from "react-aria-components";
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

export function SettingsCatalog({ children, className, label }: {
  children: ReactNode;
  className?: string;
  label: string;
}) {
  return <div aria-label={label} className={`${styles.catalog} ${className ?? ""}`} role="list">{children}</div>;
}

export function SettingsCatalogRow({
  title,
  description,
  leading,
  meta,
  trailing,
  actions,
  selected = false,
  testId,
  onSelect
}: {
  title: ReactNode;
  description?: ReactNode;
  leading?: ReactNode;
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
        {leading ? <span className={styles.catalogLeading}>{leading}</span> : null}
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
