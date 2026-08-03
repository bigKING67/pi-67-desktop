import type { SettingsSection } from "@pi67/domain";
import { ChevronDown } from "lucide-react";
import {
  Button,
  Header,
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  Popover
} from "react-aria-components";
import { messages } from "../localization/message-catalog.js";
import type { SettingsNavigationItem } from "./settings-navigation.js";
import styles from "./SettingsWorkbench.module.css";

interface VisibleSettingsGroup {
  label: string;
  items: readonly SettingsNavigationItem[];
}

export function SettingsCategoryNavigation({
  activeSection,
  currentGroupLabel,
  currentSectionLabel,
  groups,
  onClearSearch,
  onSelect
}: {
  activeSection: SettingsSection;
  currentGroupLabel: string;
  currentSectionLabel: string;
  groups: readonly VisibleSettingsGroup[];
  onClearSearch: () => void;
  onSelect: (section: SettingsSection) => void;
}) {
  return (
    <>
      <nav aria-label="设置分类" className={`${styles.navigation} ${styles.desktopNavigation}`}>
        {groups.map((group) => (
          <div aria-label={group.label} className={styles.navigationGroup} key={group.label} role="group">
            <span className={styles.navigationGroupLabel}>{group.label}</span>
            <div className={styles.navigationGroupItems}>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Button
                    aria-current={activeSection === item.id ? "page" : false}
                    className={`${styles.navigationItem} ${activeSection === item.id ? styles.selected : ""}`}
                    key={item.id}
                    onPress={() => onSelect(item.id)}
                  >
                    <Icon aria-hidden="true" size={16} />
                    <span>{item.label}</span>
                  </Button>
                );
              })}
            </div>
          </div>
        ))}
        {groups.length === 0 ? <SettingsEmptySearch onClear={onClearSearch} /> : null}
      </nav>
      <nav aria-label="设置分类" className={styles.mobileNavigation}>
        {groups.length ? (
          <MenuTrigger>
            <Button aria-label="选择设置分类" className={styles.mobileNavigationTrigger!}>
              <span><small>{currentGroupLabel}</small><strong>{currentSectionLabel}</strong></span>
              <ChevronDown aria-hidden="true" size={16} />
            </Button>
            <Popover className={styles.mobileNavigationPopover!} offset={5} placement="bottom start">
              <Menu aria-label="设置分类列表" className={styles.mobileNavigationMenu!}>
                {groups.map((group) => (
                  <MenuSection className={styles.mobileNavigationSection!} key={group.label}>
                    <Header className={styles.mobileNavigationHeader!}>{group.label}</Header>
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      return (
                        <MenuItem
                          className={styles.mobileNavigationItem!}
                          data-current={activeSection === item.id ? "true" : "false"}
                          id={item.id}
                          key={item.id}
                          onAction={() => onSelect(item.id)}
                          textValue={item.label}
                        >
                          <Icon aria-hidden="true" size={15} />
                          <span>{item.label}</span>
                        </MenuItem>
                      );
                    })}
                  </MenuSection>
                ))}
              </Menu>
            </Popover>
          </MenuTrigger>
        ) : <SettingsEmptySearch onClear={onClearSearch} />}
      </nav>
    </>
  );
}

function SettingsEmptySearch({ onClear }: { onClear: () => void }) {
  return (
    <div className={styles.emptySearch} role="status">
      <strong>没有匹配的设置</strong>
      <span>{messages.settings.emptySearchSuggestion}</span>
      <Button onPress={onClear}>清除搜索</Button>
    </div>
  );
}
