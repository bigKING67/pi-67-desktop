import type { SettingsSection } from "@pi67/domain";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { publishNotification } from "../notifications/notification-store.js";
import { rendererWorkbenchStore } from "../workbench/workbench-store.js";
import { sectionSupportsProjectScope } from "./settings-navigation.js";
import { SettingsDiscardDialog } from "./SettingsActionDialogs.js";
import { combineSettingsDrafts, type SettingsDraftRegistration, type SettingsDraftRegistrar } from "./SettingsDraftGuard.js";
import { registerSettingsLeaveGuard } from "./settings-leave-guard.js";

export type SettingsNavigationRequest =
  | { kind: "close" }
  | { kind: "section"; section: SettingsSection; subpage?: "enterprise" }
  | { kind: "scope"; scope: "global" | "project" }
  | { kind: "leave"; proceed: () => void; stay: () => void };

/**
 * Owns the Settings draft guard: draft registration, the discard dialog, waiting for pending
 * mutations, and the leave guard used by exits that start outside Settings.
 */
export function useSettingsNavigationGuard(activeSection: SettingsSection, scope: "global" | "project"): {
  registerDraft: SettingsDraftRegistrar;
  requestNavigation: (navigation: SettingsNavigationRequest) => void;
  discardDialog: ReactElement;
} {
  const [draftRegistration, setDraftRegistration] = useState<SettingsDraftRegistration>();
  const draftRegistrationRef = useRef<SettingsDraftRegistration | undefined>(undefined);
  const navigationTrigger = useRef<HTMLElement | null>(null);
  const drafts = useRef(new Set<SettingsDraftRegistration>());
  const [pendingNavigation, setPendingNavigation] = useState<SettingsNavigationRequest>();

  const registerDraft = useCallback<SettingsDraftRegistrar>((registration) => {
    const publish = () => {
      const combined = combineSettingsDrafts([...drafts.current]);
      draftRegistrationRef.current = combined;
      setDraftRegistration(combined);
    };
    drafts.current.add(registration); publish();
    return () => {
      drafts.current.delete(registration); publish();
    };
  }, []);

  const performNavigation = useCallback((navigation: SettingsNavigationRequest) => {
    const store = rendererWorkbenchStore.getState();
    if (navigation.kind === "close") {
      store.closeSettings();
      return;
    }
    if (navigation.kind === "scope") {
      store.setSettingsScope(navigation.scope);
      return;
    }
    if (navigation.kind === "leave") {
      navigation.proceed();
      return;
    }
    store.selectSettingsSection(navigation.section, navigation.subpage);
    if (!sectionSupportsProjectScope(navigation.section)) store.setSettingsScope("global");
  }, []);

  const requestNavigation = (navigation: SettingsNavigationRequest) => {
    if (draftRegistrationRef.current?.busy) {
      // Navigation cannot interrupt a pending mutation; say so instead of ignoring the request.
      publishNotification({ level: "info", title: "设置正在保存", message: "请等待当前操作完成后再离开。" });
      if (navigation.kind === "leave") navigation.stay();
      return;
    }
    if (navigation.kind === "section" && navigation.section === activeSection && !navigation.subpage) return;
    if (navigation.kind === "scope" && navigation.scope === scope) return;
    if (draftRegistrationRef.current?.dirty) {
      navigationTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setPendingNavigation((previous) => {
        if (previous?.kind === "leave") previous.stay();
        return navigation;
      });
      return;
    }
    performNavigation(navigation);
  };
  const requestNavigationRef = useRef(requestNavigation);
  requestNavigationRef.current = requestNavigation;
  useEffect(() => registerSettingsLeaveGuard((proceed, stay) => (
    requestNavigationRef.current({ kind: "leave", proceed, stay })
  )), []);

  useEffect(() => {
    if (!pendingNavigation || !draftRegistration || draftRegistration.dirty) return;
    setPendingNavigation(undefined);
    performNavigation(pendingNavigation);
  }, [draftRegistration, pendingNavigation, performNavigation]);

  const discardDialog = (
      <SettingsDiscardDialog
        busy={draftRegistration?.busy ?? false}
        open={pendingNavigation !== undefined}
        subject={draftRegistration?.subject ?? "当前设置"}
        onCancel={() => {
          if (pendingNavigation?.kind === "leave") pendingNavigation.stay();
          setPendingNavigation(undefined);
          requestAnimationFrame(() => navigationTrigger.current?.focus());
        }}
        onDiscard={() => {
          const navigation = pendingNavigation;
          draftRegistrationRef.current?.discard();
          setPendingNavigation(undefined);
          if (navigation) performNavigation(navigation);
        }}
      />
  );
  return { registerDraft, requestNavigation, discardDialog };
}
