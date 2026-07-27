import {
  Ellipsis,
  FileInput,
  RefreshCw
} from "lucide-react";
import {
  Button,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover
} from "react-aria-components";
import { messages } from "../localization/message-catalog.js";
import styles from "./NavigationRail.module.css";

export function SessionCatalogMenu({
  disabled,
  onRefresh,
  onImport
}: {
  disabled: boolean;
  onRefresh: () => void;
  onImport: () => void;
}) {
  return (
    <MenuTrigger>
      <Button className={styles.moreButton!} aria-label={messages.navigation.moreActions}>
        <Ellipsis aria-hidden="true" size={16} />
      </Button>
      <Popover className={styles.menuPopover!} placement="top end" offset={6}>
        <Menu className={styles.menu!} aria-label={messages.navigation.moreActions}>
          <MenuItem
            className={styles.menuItem!}
            isDisabled={disabled}
            onAction={onRefresh}
            textValue={messages.navigation.refresh}
          >
            <RefreshCw aria-hidden="true" size={14} />
            {messages.navigation.refresh}
          </MenuItem>
          <MenuItem
            className={styles.menuItem!}
            isDisabled={disabled}
            onAction={onImport}
            textValue={messages.navigation.importSession}
          >
            <FileInput aria-hidden="true" size={14} />
            {messages.navigation.importSession}
          </MenuItem>
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}
