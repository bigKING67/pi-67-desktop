import type {
  ExtensionCatalogCompatibility,
  ExtensionCatalogResult,
  ExtensionSurface,
  ExtensionSurfaceCompatibility
} from "@pi67/domain";
import { messages } from "../localization/message-catalog.js";
import styles from "./ExtensionCatalog.module.css";

export function ExtensionCatalog({ catalog }: { catalog: ExtensionCatalogResult | undefined }) {
  return (
    <section aria-labelledby="extension-catalog-heading" className={styles.catalog}>
      <header className={styles.heading}>
        <span className="section-label" id="extension-catalog-heading">{messages.extensionCatalog.heading}</span>
        <strong>{catalog ? catalog.total : "-"}</strong>
      </header>
      {catalog === undefined ? (
        <p className={styles.empty}>{messages.extensionCatalog.waiting}</p>
      ) : catalog.items.length === 0 ? (
        <p className={styles.empty}>{messages.extensionCatalog.empty}</p>
      ) : (
        <ul className={styles.list}>
          {catalog.items.map((item) => (
            <li className={styles.item} key={item.id}>
              <div className={styles.itemHeading}>
                <strong title={item.path}>{item.label}</strong>
                <span className={styles.overall} data-status={item.assessment.overall}>
                  {overallLabel(item.assessment.overall)}
                </span>
              </div>
              <div className={styles.meta}>
                <span>{sourceLabel(item.source?.scope, item.source?.origin)}</span>
                <span>{messages.extensionCatalog.countSummary(item.commandCount, item.toolCount)}</span>
              </div>
              {item.adapter ? (
                <p className={styles.adapter}>
                  {messages.extensionCatalog.adapterSummary(
                    item.adapter.package,
                    item.adapter.installedVersion,
                    item.adapter.commandCount,
                    item.adapter.toolCount
                  )}
                </p>
              ) : null}
              <p>{item.assessment.detail}</p>
              <dl className={styles.surfaces}>
                {item.assessment.surfaces.map((surface) => (
                  <div
                    aria-label={messages.extensionCatalog.surfaceAria(
                      surfaceLabel(surface.surface),
                      surfaceStatusLabel(surface.status),
                      surface.detail
                    )}
                    key={surface.surface}
                    title={surface.detail}
                  >
                    <dt>{surfaceLabel(surface.surface)}</dt>
                    <dd data-status={surface.status}>{surfaceStatusLabel(surface.status)}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      )}
      {catalog?.truncated ? (
        <p className={styles.truncated}>{messages.extensionCatalog.truncated(catalog.items.length, catalog.total)}</p>
      ) : null}
    </section>
  );
}

function overallLabel(status: ExtensionCatalogCompatibility): string {
  return messages.extensionCatalog.overall[status];
}

function surfaceLabel(surface: ExtensionSurface): string {
  return messages.extensionCatalog.surfaces[surface];
}

function surfaceStatusLabel(status: ExtensionSurfaceCompatibility): string {
  return messages.extensionCatalog.surfaceStatuses[status];
}

function sourceLabel(
  scope: "user" | "project" | "temporary" | undefined,
  origin: "package" | "top-level" | undefined
): string {
  const scopeLabel = scope === undefined
    ? messages.extensionCatalog.scopes.unknown
    : messages.extensionCatalog.scopes[scope];
  const originLabel = origin === "package"
    ? messages.extensionCatalog.packageOrigin
    : origin === "top-level"
      ? messages.extensionCatalog.topLevelOrigin
      : "";
  return originLabel ? `${scopeLabel} · ${originLabel}` : scopeLabel;
}
