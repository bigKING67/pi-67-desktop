import { describe, expect, it } from "vitest";
import {
  dismissConversationFind,
  requestConversationFind,
  subscribeConversationFind,
  subscribeConversationFindDismiss
} from "./conversation-find-events.js";

describe("conversation find events", () => {
  it("keeps open routing separate from lifecycle dismissal", () => {
    const opens: string[] = [];
    let dismissals = 0;
    const unsubscribeOpen = subscribeConversationFind((scope) => opens.push(scope));
    const unsubscribeDismiss = subscribeConversationFindDismiss(() => { dismissals += 1; });

    requestConversationFind("current");
    requestConversationFind("workspace");
    dismissConversationFind();

    expect(opens).toEqual(["current", "workspace"]);
    expect(dismissals).toBe(1);
    unsubscribeOpen();
    unsubscribeDismiss();
  });
});
