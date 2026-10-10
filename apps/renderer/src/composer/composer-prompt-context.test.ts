import { describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => ({ texts: [] as string[] }));
vi.mock("./prompt-submission-controller.js", () => ({ submitRendererPrompt: (text: string) => { sent.texts.push(text); return Promise.resolve({ accepted: true }); } }));
vi.mock("../session/new-session-intent-controller.js", () => ({ submitRendererNewSessionIntent: (_task: string, text: string) => { sent.texts.push(text); return Promise.resolve({ accepted: true }); } }));

import { composerPromptContext, setComposerPromptContext } from "./composer-prompt-context.js";
import { clearAcceptedComposerDraft, submitComposerDraft } from "./composer-submission-controller.js";

const draft = (text: string, provisional = false) => ({ taskId: "t", provisional, text, submissionId: "s", attachments: [], workspaceFiles: [], activeStreaming: false, streamBehavior: "steer" as const });

describe("composer prompt context", () => {
  it("attaches the installed block to new and existing conversations until released", async () => {
    const release = setComposerPromptContext(() => "<image-context>\nproject: poster\n</image-context>");
    expect(composerPromptContext()).toContain("poster");
    await submitComposerDraft(draft("换背景"));
    await submitComposerDraft(draft("出三个尺寸", true));
    release();
    await submitComposerDraft(draft("普通对话"));
    expect(sent.texts).toEqual(["换背景\n\n<image-context>\nproject: poster\n</image-context>", "出三个尺寸\n\n<image-context>\nproject: poster\n</image-context>", "普通对话"]);
  });

  it("lets a newer provider replace an older one, and an old release not clear the newer", () => {
    const first = setComposerPromptContext(() => "a");
    setComposerPromptContext(() => "b");
    first();
    expect(composerPromptContext()).toBe("b");
  });

  it("tells the surface only when a prompt that carried its block is accepted", async () => {
    let block: string | undefined;
    const accepted = vi.fn();
    const release = setComposerPromptContext(() => block, accepted);
    const accept = () => clearAcceptedComposerDraft({ taskId: "t", result: { accepted: true } as never, attachments: [], reviewCommentIds: [] });
    await submitComposerDraft(draft("没有附带"));
    accept();
    expect(accepted).not.toHaveBeenCalled();
    block = "<image-context>\nproject: poster\n</image-context>";
    await submitComposerDraft(draft("带标记"));
    accept();
    accept();
    expect(accepted).toHaveBeenCalledTimes(1);
    // The surface left while this prompt was in flight: its acceptance still retires what it carried.
    await submitComposerDraft(draft("再发一次"));
    release();
    accept();
    expect(accepted).toHaveBeenCalledTimes(2);
    await submitComposerDraft(draft("离开以后"));
    accept();
    expect(accepted).toHaveBeenCalledTimes(2);
  });
});
