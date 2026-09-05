import { beforeEach, describe, expect, it, vi } from "vitest";
import { agentConnectionController } from "../connection/AgentConnectionController.js";
import { workspaceFileStore } from "./workspace-file-store.js";

const register = vi.hoisted(() => vi.fn());
vi.mock("../workbench/workspace-host-registration-controller.js", () => ({ registerRendererWorkspaceWithHost: register }));
import { saveWorkspaceFile } from "./workspace-file-controller.js";

const workspace = { id: "workspace-a", displayName: "A", identity: { canonicalPath: "/work/a", assurance: "filesystem" as const }, trust: "trusted" as const, trustProvenance: "native-picker" as const, availability: "available" as const };

describe("workspace file save", () => {
 beforeEach(() => { workspaceFileStore.setState(workspaceFileStore.getInitialState(),true); vi.restoreAllMocks(); register.mockReset().mockResolvedValue(true); });
 it("keeps later edits dirty and refuses save-and-close until their snapshot is saved", async () => {
  const gate=deferred<{entry:{id:string;name:string;relativePath:string;kind:"file";revision:string}}>();
  workspaceFileStore.getState().beginOpen("workspace-a",{id:"file-a",name:"a.ts",relativePath:"src/a.ts",revision:"r1"});
  workspaceFileStore.getState().installOpenResult("workspace-a",{id:"file-a",relativePath:"src/a.ts",kind:"text",totalBytes:1,revision:"r1",content:"A"});
  const request=vi.spyOn(agentConnectionController,"request").mockReturnValue(gate.promise as never);
  const saving=saveWorkspaceFile(workspace,"src/a.ts");
  await vi.waitFor(()=>expect(request).toHaveBeenCalledOnce());
  expect(request).toHaveBeenCalledWith("workspace.file.save",{id:"file-a",expectedRevision:"r1",content:"A"},[],{context:{scope:"workspace",workspaceId:"workspace-a"}});
  workspaceFileStore.getState().updateContent("workspace-a","src/a.ts","B");
  await expect(saveWorkspaceFile(workspace,"src/a.ts")).resolves.toBe(false);
  expect(request).toHaveBeenCalledOnce();
  gate.resolve({entry:{id:"file-a",name:"a.ts",relativePath:"src/a.ts",kind:"file",revision:"r2"}});
  await expect(saving).resolves.toBe(false);
  expect(workspaceFileStore.getState().workspaces["workspace-a"]?.byPath["src/a.ts"]).toMatchObject({content:"B",savedContent:"A",revision:"r2",dirty:true,conflict:false});
  request.mockResolvedValue({entry:{id:"file-a",name:"a.ts",relativePath:"src/a.ts",kind:"file",revision:"r3"}} as never);
  await expect(saveWorkspaceFile(workspace,"src/a.ts")).resolves.toBe(true);
  expect(request).toHaveBeenLastCalledWith("workspace.file.save",{id:"file-a",expectedRevision:"r2",content:"B"},[],{context:{scope:"workspace",workspaceId:"workspace-a"}});
  expect(workspaceFileStore.getState().workspaces["workspace-a"]?.byPath["src/a.ts"]).toMatchObject({content:"B",savedContent:"B",revision:"r3",dirty:false,conflict:false});
 });
});
function deferred<T>() { let resolve!: (v:T)=>void; const promise=new Promise<T>(r=>{resolve=r;}); return {promise,resolve}; }
