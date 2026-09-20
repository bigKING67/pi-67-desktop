import { useEffect } from "react";
import { useStore } from "zustand";
import { useAppStore } from "../app/app-store.js";
import { loadEnterpriseIdentity } from "./context-memory-controller.js";
import { invalidateNewMoneyIdentity, newMoneyAccountStore } from "./new-money-account-store.js";

export function useNewMoneyAccount() {
  const snapshot = useStore(newMoneyAccountStore);
  const connected = useAppStore(state => state.connected);
  useEffect(() => {
    if (!connected) { invalidateNewMoneyIdentity(); return; }
    const refresh = () => { if (document.visibilityState !== "hidden") void loadEnterpriseIdentity().catch(() => undefined); };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [connected]);
  // Credential expiry changes display only; it never grants or refreshes authorization.
  useEffect(() => {
    const identity = snapshot.identity;
    if (identity?.state !== "signed-in" || !identity.expiresAt) return;
    const timer = setTimeout(() => { void loadEnterpriseIdentity().catch(() => undefined); }, Math.min(2_147_483_647, Math.max(0, identity.expiresAt - Date.now()) + 100));
    return () => clearTimeout(timer);
  }, [snapshot.identity]);
  return snapshot;
}
