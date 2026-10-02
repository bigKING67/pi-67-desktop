import { describe, expect, it } from "vitest";
import { teamChatSearchSegments } from "./team-chat-search-presentation.js";

describe("team chat search presentation", () => {
  it("marks every case-insensitive match, including astral characters", () => {
    expect(teamChatSearchSegments("Deploy the API, then api docs", " api ")).toEqual([
      { text: "Deploy the ", match: false }, { text: "API", match: true }, { text: ", then ", match: false },
      { text: "api", match: true }, { text: " docs", match: false }
    ]);
    expect(teamChatSearchSegments("…港股口径😀口径", "口径")).toEqual([
      { text: "…港股", match: false }, { text: "口径", match: true }, { text: "😀", match: false }, { text: "口径", match: true }
    ]);
    expect(teamChatSearchSegments("abc", "")).toEqual([{ text: "abc", match: false }]);
  });
});
