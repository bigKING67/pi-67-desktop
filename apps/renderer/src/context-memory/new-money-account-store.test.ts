import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EnterpriseIdentityStatus } from "@pi67/domain";
import { invalidateNewMoneyIdentity, newMoneyAccountLabel, newMoneyAccountStore, publishNewMoneyIdentity, refreshNewMoneyIdentity } from "./new-money-account-store.js";

beforeEach(invalidateNewMoneyIdentity);
describe("shared New Money presentation state", () => {
  it("does not label unknown or failed reads as signed out", async () => {
    expect(newMoneyAccountLabel(newMoneyAccountStore.getState()).title).toBe("New Money 账户");
    await expect(refreshNewMoneyIdentity(async () => { throw Error("offline"); })).rejects.toThrow();
    expect(newMoneyAccountLabel(newMoneyAccountStore.getState()).title).toBe("账户状态待确认");
  });
  it("deduplicates concurrent readers and publishes the same identity to every surface", async () => {
    let resolve!: (value: EnterpriseIdentityStatus) => void;
    const read = vi.fn(() => new Promise<EnterpriseIdentityStatus>(done => { resolve = done; }));
    const first = refreshNewMoneyIdentity(read), second = refreshNewMoneyIdentity(read);
    expect(first).toBe(second); expect(read).toHaveBeenCalledTimes(1);
    resolve({ state: "signed-in", displayName: "Test account" }); await first;
    expect(newMoneyAccountLabel(newMoneyAccountStore.getState())).toEqual({title:"Test account",detail:"已登录 · 账户与团队"});
  });
  it("does not allow a late signed-in read to undo logout", async () => {
    let resolve!: (value: EnterpriseIdentityStatus) => void;
    const old = refreshNewMoneyIdentity(() => new Promise(done => { resolve = done; }));
    publishNewMoneyIdentity({state:"signed-out"}); resolve({state:"signed-in"}); await old;
    expect(newMoneyAccountStore.getState().identity?.state).toBe("signed-out");
  });
  it("ignores errors from obsolete reads after a successful login", async () => {
    let reject!: (error: Error) => void;
    const old = refreshNewMoneyIdentity(() => new Promise((_resolve, fail) => { reject = fail; }));
    publishNewMoneyIdentity({state:"signed-in"}); reject(Error("late")); await expect(old).rejects.toThrow();
    expect(newMoneyAccountStore.getState().error).toBeUndefined();
    expect(newMoneyAccountStore.getState().identity?.state).toBe("signed-in");
  });
  it.each([
    ["signed-out", "登录 New Money"], ["pending", "等待登录确认"], ["expired", "重新登录 New Money"]
  ] as const)("gives %s its own actionable label", (state, title) => {
    publishNewMoneyIdentity({state}); expect(newMoneyAccountLabel(newMoneyAccountStore.getState()).title).toBe(title);
  });
  it("preserves identity reference for unchanged reads without a render-refresh loop", () => {
    publishNewMoneyIdentity({state:"signed-in",userId:"test"});
    const previous = newMoneyAccountStore.getState().identity;
    publishNewMoneyIdentity({state:"signed-in",userId:"test"}); expect(newMoneyAccountStore.getState().identity).toBe(previous);
  });
});
