import type { ChildProcess } from "node:child_process";

export interface PackageWorkerProcessTreeTermination {
  force: boolean;
  platform: NodeJS.Platform;
  environment: NodeJS.ProcessEnv;
  deadlineMs: number;
}

export type PackageWorkerProcessTreeTerminator = (
  child: ChildProcess,
  termination: PackageWorkerProcessTreeTermination
) => Promise<boolean | void>;

export type PackageWorkerProcessTreeInspector = (
  child: ChildProcess,
  platform: NodeJS.Platform,
  deadlineMs?: number
) => Promise<boolean>;

export interface PackageWorkerProcessTreeController {
  attach(child: ChildProcess): Promise<void>;
  terminate: PackageWorkerProcessTreeTerminator;
  inspect: PackageWorkerProcessTreeInspector;
  dispose(): Promise<void>;
}
