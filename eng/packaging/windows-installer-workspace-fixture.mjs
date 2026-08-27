import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function prepareWindowsInstallerWorkspaceFixture(workspace) {
  await mkdir(join(workspace, ".git"), { recursive: true });
  await Promise.all([
    writeFile(join(workspace, "README.md"), "Windows installed lifecycle fixture.\n", "utf8"),
    writeFile(join(workspace, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8"),
    writeFile(
      join(workspace, ".git", "config"),
      "[core]\n\trepositoryformatversion = 0\n\tbare = false\n",
      "utf8"
    )
  ]);
}
