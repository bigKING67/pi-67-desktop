import { useEffect, useRef } from "react";
import { messages } from "../localization/message-catalog.js";
import type { PaletteAction, PaletteGroup } from "./command-palette-model.js";
import styles from "./CommandPalette.module.css";

interface CommandPaletteResultsProps {
  groups: readonly PaletteGroup[];
  selectedKey: string | undefined;
  activeSessionFileIdentity: string | undefined;
  onSelect: (key: string) => void;
  onExecute: (item: PaletteAction) => void;
}

export function CommandPaletteResults({
  groups,
  selectedKey,
  activeSessionFileIdentity,
  onSelect,
  onExecute
}: CommandPaletteResultsProps) {
  const itemRefs = useRef(new Map<string, HTMLDivElement>());

  useEffect(() => {
    if (!selectedKey) return;
    itemRefs.current.get(selectedKey)?.scrollIntoView({ block: "nearest" });
  }, [selectedKey]);

  return (
    <div
      id="command-palette-results"
      className={styles.results!}
      aria-label={messages.commandPalette.results}
      role="listbox"
    >
      {groups.map((group) => (
        <section
          aria-labelledby={`command-palette-group-${group.id}`}
          className={styles.group!}
          key={group.id}
          role="group"
        >
          <div className={styles.groupHeading} id={`command-palette-group-${group.id}`}>{group.label}</div>
          {group.items.map((item) => (
            <div
              aria-disabled={item.disabled || undefined}
              aria-selected={selectedKey === item.id}
              className={styles.item!}
              data-disabled={item.disabled || undefined}
              data-selected={selectedKey === item.id || undefined}
              id={paletteOptionId(item.id)}
              key={item.id}
              onClick={() => {
                if (!item.disabled) onExecute(item);
              }}
              onMouseDown={(event) => {
                // The combobox remains the sole focus owner while pointer selection changes.
                event.preventDefault();
              }}
              onPointerMove={() => {
                if (!item.disabled) onSelect(item.id);
              }}
              ref={(element) => {
                if (element) itemRefs.current.set(item.id, element);
                else itemRefs.current.delete(item.id);
              }}
              role="option"
            >
              <item.icon aria-hidden="true" className={styles.itemIcon} size={16} />
              <span className={styles.itemCopy}>
                <strong>{item.label}</strong>
                <small>{item.disabledReason ?? item.detail}</small>
              </span>
              {item.group === "sessions" && item.id === `session:${activeSessionFileIdentity ?? ""}` ? (
                <span className={styles.currentBadge}>{messages.commandPalette.current}</span>
              ) : item.shortcut ? <kbd className={styles.currentBadge}>{item.shortcut}</kbd> : null}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

export function paletteOptionId(actionId: string): string {
  return `command-palette-option-${encodeURIComponent(actionId)}`;
}
