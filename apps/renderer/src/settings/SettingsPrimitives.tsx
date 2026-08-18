import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "react-aria-components";
import styles from "./SettingsPrimitives.module.css";

export function SettingsPageHeader({ title, description, actions }: {
  title: ReactNode;
  description: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className={styles.pageHeader}>
      <span className={styles.pageHeading}>
        <h1>{title}</h1>
        <p>{description}</p>
      </span>
      {actions ? <div className={styles.pageActions}>{actions}</div> : null}
    </header>
  );
}

export function SettingsSectionBlock({ title, description, actions, children, className }: {
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`${styles.section} ${className ?? ""}`}>
      <header className={styles.sectionHeader}>
        <span><h3>{title}</h3><p>{description}</p></span>
        {actions ? <div className={styles.sectionActions}>{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function SettingsRows({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`${styles.rows} ${className ?? ""}`}>{children}</div>;
}

export function SettingsRow({ leading, title, description, value, actions, children, className }: {
  leading?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  value?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`${styles.row} ${className ?? ""}`}>
      {leading ? <span className={styles.leading}>{leading}</span> : null}
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
