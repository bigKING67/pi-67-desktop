import { expect, it } from "vitest";
import { startPrivateMemoryModel } from "./packaged-private-memory-model.mjs";

it("requires explicit TLS for the native team fixture instead of weakening the product policy", async () => {
  await expect(startPrivateMemoryModel({ teamNative: true })).rejects.toThrow("requires explicit TLS");
});

it("does not mistake a generated reply or an isolated marker for source-backed recall", async () => {
  const model = await startPrivateMemoryModel();
  try {
    for (const [content, recalled] of [
      ["NM-PACKAGED-RECALL: What do I prefer?", false],
      ["NM-PACKAGED-RECALL NM-PACKAGED-PRIVATE-ONE", false],
      ["NM-PACKAGED-RECALL NM-PACKAGED-PRIVATE-ONE /memories/preferences/desktop/communication_style.md", true]
    ]) {
      const result = await post(model, "agent", content, true);
      expect(result.status).toBe(200);
      expect(await result.text()).toContain("本地私人记忆合成回复 3。");
      expect(model.evidence.recalledPreference).toBe(recalled);
    }
    expect(model.counts).toEqual({ agent: 3, embedding: 0, extraction: 0, rejected: 0 });
  } finally { await model.close(); }
});

it("only completes the pinned synthetic extraction and summary purposes", async () => {
  const model = await startPrivateMemoryModel();
  try {
    const invalid = await post(model, "extract", "## Page ID Rules");
    expect(invalid.status).toBe(400);
    await invalid.text();
    expect(model.evidence.preferenceExtractions).toBe(0);
    const extracted = await post(model, "extract", "## Page ID Rules NM-PACKAGED-PRIVATE-ONE");
    const body = await extracted.json();
    expect(JSON.parse(body.choices[0].message.content)).toMatchObject({ preferences: [
      { page_id: 100, user: "desktop", topic: "communication_style" }
    ] });
    const summary = await post(model, "extract", "You are a session note-taker NM-PACKAGED-PRIVATE-ONE");
    expect(summary.status).toBe(200);
    await summary.text();
    expect(model.evidence).toEqual({ preferenceExtractions: 1, summaries: 1, recalledPreference: false });
    expect(model.counts.extraction).toBe(2);
  } finally { await model.close(); }
});

function post(model, name, content, stream = false) {
  return fetch(`${model.endpoint}/chat/completions`, { method: "POST",
    headers: { authorization: "Bearer synthetic-memory-only", "content-type": "application/json" },
    body: JSON.stringify({ model: name, stream, messages: [{ role: "user", content }] }) });
}
