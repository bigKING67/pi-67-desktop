import { mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { safeAtomicReplaceFile } from "./safe-atomic-io.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("safe atomic IO", () => {
  it("flushes a same-directory file and replaces the target only after the commit fence", async () => {
    const root = await temporaryRoot();
    const target = join(root, "settings.json");
    await writeFile(target, "before\n", { mode: 0o640 });
    const beforeCommit = vi.fn(async () => {
      await expect(readFile(target, "utf8")).resolves.toBe("before\n");
    });

    await safeAtomicReplaceFile(target, "after\n", { mode: 0o640, beforeCommit });

    expect(beforeCommit).toHaveBeenCalledOnce();
    await expect(readFile(target, "utf8")).resolves.toBe("after\n");
    expect((await stat(target)).mode & 0o777).toBe(process.platform === "win32" ? expect.any(Number) : 0o640);
    expect(await readdir(root)).toEqual(["settings.json"]);
  });

  it("retries only bounded Windows sharing-style replacement failures", async () => {
    const root = await temporaryRoot();
    const target = join(root, "models.json");
    const delays: number[] = [];
    let attempts = 0;

    await safeAtomicReplaceFile(target, "{}\n", {
      platform: "win32",
      sleep: async (milliseconds) => { delays.push(milliseconds); },
      renameFile: async (source, destination) => {
        attempts += 1;
        if (attempts <= 2) throw nodeError("EACCES");
        await rename(source, destination);
      }
    });

    expect(attempts).toBe(3);
    expect(delays).toEqual([25, 50]);
    await expect(readFile(target, "utf8")).resolves.toBe("{}\n");
  });

  it("rechecks the revision fence before every Windows replacement retry", async () => {
    const root = await temporaryRoot();
    const target = join(root, "mcp.json");
    await writeFile(target, "before\n");
    let attempts = 0;
    let fences = 0;

    await expect(safeAtomicReplaceFile(target, "pi67\n", {
      platform: "win32",
      sleep: async () => {
        await writeFile(target, "external\n");
      },
      beforeCommit: async () => {
        fences += 1;
        if (await readFile(target, "utf8") !== "before\n") {
          throw new Error("revision conflict");
        }
      },
      renameFile: async (source, destination) => {
        attempts += 1;
        if (attempts === 1) throw nodeError("EPERM");
        await rename(source, destination);
      }
    })).rejects.toThrow("revision conflict");

    expect(attempts).toBe(1);
    expect(fences).toBe(2);
    await expect(readFile(target, "utf8")).resolves.toBe("external\n");
    expect(await readdir(root)).toEqual(["mcp.json"]);
  });

  it("does not retry semantic conflicts or non-Windows failures", async () => {
    for (const fixture of [
      { platform: "win32" as const, code: "EEXIST" },
      { platform: "darwin" as const, code: "EACCES" }
    ]) {
      const root = await temporaryRoot();
      const target = join(root, `${fixture.platform}.json`);
      let attempts = 0;
      await expect(safeAtomicReplaceFile(target, "{}", {
        platform: fixture.platform,
        sleep: async () => undefined,
        renameFile: async () => {
          attempts += 1;
          throw nodeError(fixture.code);
        }
      })).rejects.toMatchObject({ code: fixture.code });
      expect(attempts).toBe(1);
      expect(await readdir(root)).toEqual([]);
    }
  });

  it("leaves the target untouched when the pre-commit revision fence fails", async () => {
    const root = await temporaryRoot();
    const target = join(root, "project.json");
    await writeFile(target, "external\n");

    await expect(safeAtomicReplaceFile(target, "draft\n", {
      beforeCommit: async () => { throw new Error("revision conflict"); }
    })).rejects.toThrow("revision conflict");

    await expect(readFile(target, "utf8")).resolves.toBe("external\n");
    expect(await readdir(root)).toEqual(["project.json"]);
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pi67-safe-atomic-io-"));
  roots.push(root);
  return root;
}

function nodeError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}
