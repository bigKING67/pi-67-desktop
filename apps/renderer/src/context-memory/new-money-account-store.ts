import type { EnterpriseIdentityStatus } from "@pi67/domain";
import { createStore } from "zustand/vanilla";

interface AccountSnapshot {
  identity: EnterpriseIdentityStatus | undefined;
  loading: boolean;
  error: string | undefined;
}
export const newMoneyAccountStore = createStore<AccountSnapshot>(() => ({ identity: undefined, loading: false, error: undefined }));
let generation = 0;
let pending: Promise<EnterpriseIdentityStatus> | undefined;

export function invalidateNewMoneyIdentity(): void {
  generation += 1;
  pending = undefined;
  newMoneyAccountStore.setState({ identity: undefined, loading: false, error: undefined });
}

export function publishNewMoneyIdentity(identity: EnterpriseIdentityStatus): void {
  generation += 1;
  pending = undefined;
  const previous = newMoneyAccountStore.getState().identity;
  newMoneyAccountStore.setState({ identity: JSON.stringify(previous) === JSON.stringify(identity) ? previous : identity,
    loading: false, error: undefined });
}

/** Presentation cache only. Host remains the authorization authority; never persist credentials here. */
export function refreshNewMoneyIdentity(read: () => Promise<EnterpriseIdentityStatus>): Promise<EnterpriseIdentityStatus> {
  if (pending) return pending;
  const current = ++generation;
  newMoneyAccountStore.setState({ loading: true, error: undefined });
  const request = read().then(identity => {
    if (current === generation) publishNewMoneyIdentity(identity);
    return identity;
  }, (error: unknown) => {
    if (current === generation) newMoneyAccountStore.setState({ identity: undefined, loading: false, error: "无法确认账户状态，请重试。" });
    throw error;
  }).finally(() => { if (pending === request) pending = undefined; });
  pending = request;
  return request;
}

/** `initial` is present only for a confirmed signed-in identity; the footer then shows a compact avatar row. */
export function newMoneyAccountLabel(snapshot: AccountSnapshot): { title: string; detail: string; initial?: string } {
  if (snapshot.error) return { title: "账户状态待确认", detail: "打开账户设置重试" };
  const identity = snapshot.identity;
  if (!identity) return { title: "New Money 账户", detail: snapshot.loading ? "正在检查登录状态…" : "打开账户设置" };
  if (identity.state === "signed-in") {
    const title = identity.displayName?.trim() || "New Money 用户";
    return { title, detail: "已登录 · 账户与团队", initial: Array.from(title)[0]!.toLocaleUpperCase() };
  }
  if (identity.state === "pending") return { title: "等待登录确认", detail: "打开账户设置" };
  if (identity.state === "expired") return { title: "重新登录 New Money", detail: "登录已过期" };
  return { title: "登录 New Money", detail: "未登录也可使用私人会话" };
}
