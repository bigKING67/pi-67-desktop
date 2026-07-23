import { Check, Monitor, Moon, Sun } from "lucide-react";
import { Button, Menu, MenuItem, MenuTrigger, Popover } from "react-aria-components";
import {
  setThemePreference,
  type ThemePreference,
  useThemeSnapshot
} from "./theme-controller.js";

const OPTIONS: ReadonlyArray<{ id: ThemePreference; label: string; detail: string }> = [
  { id: "system", label: "跟随系统", detail: "随 Windows 或 macOS 外观变化" },
  { id: "light", label: "浅色", detail: "始终使用明亮工作区" },
  { id: "dark", label: "深色", detail: "始终使用低眩光工作区" }
];

const PREFERENCE_LABELS: Readonly<Record<ThemePreference, string>> = {
  system: "跟随系统",
  light: "浅色",
  dark: "深色"
};

export function ThemeButton({ variant = "icon" }: { variant?: "icon" | "navigation" }) {
  const theme = useThemeSnapshot();
  const EffectiveIcon = theme.effective === "dark" ? Moon : Sun;
  const currentLabel = PREFERENCE_LABELS[theme.preference];
  const navigation = variant === "navigation";

  return (
    <MenuTrigger>
      <Button
        className={navigation ? "navigation-action theme-navigation-trigger" : "icon-button theme-trigger"}
        aria-label={`外观：${currentLabel}，当前${theme.effective === "dark" ? "深色" : "浅色"}`}
        {...(navigation ? {} : { "aria-describedby": "theme-trigger-tooltip" })}
      >
        <EffectiveIcon aria-hidden="true" size={15} />
        {navigation ? <><span>外观</span><small>{currentLabel}</small></> : (
          <span className="control-tooltip" id="theme-trigger-tooltip" role="tooltip">外观</span>
        )}
      </Button>
      <Popover className="theme-popover" placement={navigation ? "top start" : "bottom end"} offset={6}>
        <div className="theme-popover-content">
          <div className="theme-menu-heading">
            <strong>外观</strong>
            <span>当前{theme.effective === "dark" ? "深色" : "浅色"}</span>
          </div>
          <Menu
            className="theme-menu"
            aria-label="外观主题"
            selectionMode="single"
            selectedKeys={[theme.preference]}
          >
            {OPTIONS.map((option) => (
              <MenuItem
                className="theme-menu-item"
                id={option.id}
                key={option.id}
                onAction={() => setThemePreference(option.id)}
                textValue={option.label}
              >
                {({ isSelected }) => (
                  <>
                    <ThemeOptionIcon preference={option.id} />
                    <span className="theme-option-copy">
                      <strong>{option.label}</strong>
                      <small>{option.detail}</small>
                    </span>
                    <Check className={`theme-selection${isSelected ? " is-visible" : ""}`} size={14} />
                  </>
                )}
              </MenuItem>
            ))}
          </Menu>
          {theme.persistence === "memory" ? (
            <p className="theme-persistence-note">主题存储不可用；选择仅在本次运行有效。</p>
          ) : null}
        </div>
      </Popover>
    </MenuTrigger>
  );
}

function ThemeOptionIcon({ preference }: { preference: ThemePreference }) {
  if (preference === "system") return <Monitor aria-hidden="true" size={15} />;
  if (preference === "dark") return <Moon aria-hidden="true" size={15} />;
  return <Sun aria-hidden="true" size={15} />;
}
