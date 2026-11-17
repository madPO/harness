import { afterEach, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { CustomCommandAPI, CustomCommandContext, CustomCommandFactory, ExecResult } from "@oh-my-pi/pi-coding-agent";
import factory from "../omp/agent/commands/deep-review/index";
import { GitError, Repository } from "../omp/agent/commands/deep-review/repository";

const temporaryDirectories: string[] = [];
const exec: CustomCommandAPI["exec"] = (command, args, options) => {
  const { promise, resolve, reject } = Promise.withResolvers<ExecResult>();
  execFile(command, args, {
    cwd: options?.cwd,
    signal: options?.signal,
    timeout: options?.timeout,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_AUTHOR_NAME: "Deep Review Test",
      GIT_AUTHOR_EMAIL: "deep-review@example.invalid",
      GIT_COMMITTER_NAME: "Deep Review Test",
      GIT_COMMITTER_EMAIL: "deep-review@example.invalid",
    },
  }, (error, stdout, stderr) => {
    if (error && typeof error.code !== "number" && !error.killed && error.name !== "AbortError") {
      reject(error);
      return;
    }
    resolve({ stdout, stderr, code: error ? typeof error.code === "number" ? error.code : -1 : 0, killed: Boolean(error?.killed || error?.name === "AbortError") });
  });
  return promise;
};

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "deep-review-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function git(cwd: string, ...args: string[]) {
  const result = await exec("git", args, { cwd, timeout: 10_000 });
  if (result.code !== 0 || result.killed) throw new Error(result.stderr);
  return result.stdout.trim();
}

async function fixture() {
  const cwd = await temporaryDirectory();
  await git(cwd, "init", "--initial-branch=main");
  await writeFile(join(cwd, "initial.txt"), "initial\n");
  await git(cwd, "add", "--", "initial.txt");
  await git(cwd, "commit", "-m", "root");
  return { cwd, repository: await Repository.open(cwd, exec), root: await git(cwd, "rev-parse", "HEAD") };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("portable deep-review repository", () => {
  test("preserves NUL-delimited filenames, rename sides, deletions, and all working-tree inventories", async () => {
    const { cwd, repository } = await fixture();
    const original = " old\tname\n.txt";
    const renamed = "new\nname with spaces.txt";
    await writeFile(join(cwd, original), "rename contents\n");
    await git(cwd, "add", "--", original);
    await git(cwd, "commit", "-m", "weird name");
    await git(cwd, "mv", "--", original, renamed);
    await git(cwd, "rm", "--", "initial.txt");
    await writeFile(join(cwd, renamed), "rename contents\nunstaged\n");
    const untracked = " untracked\nfile\t ";
    await writeFile(join(cwd, untracked), "new\n");
    expect((await repository.changedFiles({ cached: true })).sort()).toEqual([original, renamed, "initial.txt"].sort());
    expect(await repository.changedFiles({})).toEqual([renamed]);
    expect(await repository.lsFiles(true, true)).toEqual([untracked]);
  });

  test("pins root commits, computes PR scope from merge base, and reports detached HEAD", async () => {
    const { cwd, repository, root } = await fixture();
    expect(await repository.commitDetails(root)).toEqual({ sha: root, parents: [] });
    expect(await repository.lsTree(root, [])).toEqual(["initial.txt"]);
    await git(cwd, "checkout", "-b", "feature");
    await writeFile(join(cwd, "feature.txt"), "feature\n");
    await git(cwd, "add", ".");
    await git(cwd, "commit", "-m", "feature");
    const head = (await repository.headSha())!;
    await git(cwd, "checkout", "main");
    await writeFile(join(cwd, "main.txt"), "main\n");
    await git(cwd, "add", ".");
    await git(cwd, "commit", "-m", "main");
    expect(await repository.mergeBase("main", head)).toBe(root);
    expect(await repository.changedFiles({ base: root, head })).toEqual(["feature.txt"]);
    await git(cwd, "checkout", "--detach", head);
    expect(await repository.currentBranch()).toBeNull();
    expect(await repository.headSha()).toBe(head);
    expect((await repository.commitDetails("feature")).sha).toBe(head);
    await expect(repository.commitDetails("--all")).rejects.toThrow("Invalid revision");
  });

  test("distinguishes unborn HEAD, unrelated histories, and missing active repositories", async () => {
    const cwd = await temporaryDirectory();
    const discoveryCalls: Array<{ command: string; args: string[]; cwd: string | undefined }> = [];
    const discoveryExec: CustomCommandAPI["exec"] = (command, args, options) => {
      discoveryCalls.push({ command, args, cwd: options?.cwd });
      return exec(command, args, options);
    };
    await expect(Repository.open(cwd, discoveryExec)).rejects.toBeInstanceOf(GitError);
    expect(discoveryCalls).toEqual([{ command: "git", args: ["rev-parse", "--show-toplevel"], cwd }]);
    await git(cwd, "init", "--initial-branch=main");
    const repository = await Repository.open(cwd, exec);
    expect(await repository.headSha()).toBeNull();
    await writeFile(join(cwd, "one"), "one");
    await git(cwd, "add", ".");
    await git(cwd, "commit", "-m", "one");
    const first = (await repository.headSha())!;
    await git(cwd, "checkout", "--orphan", "other");
    await git(cwd, "commit", "-m", "other");
    expect(await repository.mergeBase(first, (await repository.headSha())!)).toBeNull();
  });

  test("preserves opaque discovery diagnostics without interpreting their language or cause", async () => {
    const cwd = await temporaryDirectory();
    for (const stderr of [
      "fatal: not a git repository (or any of the parent directories): .git\n",
      "fatal: не найден git репозиторий (или один из родительских каталогов): .git\n",
      "fatal: cannot read repository: Permission denied\n",
      "fatal: bad object HEAD\n",
    ]) {
      const calls: Array<{ command: string; args: string[]; cwd: string | undefined }> = [];
      const boundary: CustomCommandAPI["exec"] = async (command, args, options) => {
        calls.push({ command, args, cwd: options?.cwd });
        return { stdout: "", stderr, code: 128, killed: false };
      };
      const discovery = Repository.open(cwd, boundary);
      await expect(discovery).rejects.toBeInstanceOf(GitError);
      await expect(discovery).rejects.toMatchObject({ code: 128, stderr, killed: false });
      expect(calls).toEqual([{ command: "git", args: ["rev-parse", "--show-toplevel"], cwd }]);
    }
  });

  test("propagates fatal and killed execution instead of returning empty inventories", async () => {
    const { cwd } = await fixture();
    for (const failure of [
      { stdout: "", stderr: "fatal: cannot read index", code: 128, killed: false },
      { stdout: "", stderr: "", code: -1, killed: true },
    ]) {
      const boundary: CustomCommandAPI["exec"] = (command, args, options) =>
        args[0] === "rev-parse" ? exec(command, args, options) : Promise.resolve(failure);
      const repository = await Repository.open(cwd, boundary);
      await expect(repository.changedFiles({})).rejects.toBeInstanceOf(GitError);
      await expect(repository.lsFiles(true, true)).rejects.toBeInstanceOf(GitError);
      await expect(repository.listBranches(false)).rejects.toBeInstanceOf(GitError);
    }
    await expect(Repository.open(cwd, async () => ({ stdout: "", stderr: "", code: -1, killed: true }))).rejects.toThrow("timed out");
  });
});

async function command(cwd: string, create: CustomCommandFactory = factory) {
  const api = { cwd, exec } as CustomCommandAPI;
  const ctx = { hasUI: false, sessionManager: { getCwd: () => cwd } };
  const instance = await create(api);
  if (Array.isArray(instance)) throw new Error("Expected one deep-review command.");
  return { instance, ctx: ctx as CustomCommandContext };
}

describe("deep-review command consumers", () => {
  test("loads a copy outside the repository without runtime packages", async () => {
    const isolated = await temporaryDirectory();
    const copied = join(isolated, "deep-review");
    await cp(new URL("../omp/agent/commands/deep-review", import.meta.url), copied, { recursive: true });
    // The runtime-generated copy path must resolve without the repository's packages.
    const copiedModule = await import(pathToFileURL(join(copied, "index.ts")).href);
    const { cwd } = await fixture();
    const { instance, ctx } = await command(cwd, copiedModule.default);
    expect(await instance.execute(["mode"], ctx)).toContain("Deep review mode: auto");
    const completions = await instance.getArgumentCompletions!("pr ma", cwd);
    expect(completions?.map((entry) => entry.value)).toContain("pr main");
  });

  test("mode settings use the active repository and completion keeps ambiguous full refs", async () => {
    const { cwd } = await fixture();
    await git(cwd, "branch", "origin/topic");
    await git(cwd, "update-ref", "refs/remotes/origin/topic", "HEAD");
    const { instance, ctx } = await command(cwd);
    expect(await instance.execute(["mode", "quick"], ctx)).toContain("Deep review mode: quick");
    expect(JSON.parse(await readFile(join(cwd, ".omp", "deep-review-settings.json"), "utf8")).mode).toBe("quick");
    const completions = await instance.getArgumentCompletions!("pr origin/topic", cwd);
    expect(completions?.map((entry) => entry.value).sort()).toEqual(["pr refs/heads/origin/topic", "pr refs/remotes/origin/topic"]);
    await expect(instance.execute(["pr", "origin/topic"], ctx)).rejects.toThrow("Ambiguous reference");
  });

  test("root commit creates a complete manifest and merge commit mode is rejected", async () => {
    const { cwd, root } = await fixture();
    const { instance, ctx } = await command(cwd);
    const result = await instance.execute(["commit", root], ctx);
    expect(typeof result).toBe("string");
    const protocol = (result as string).split("Shared worker protocol:\n")[1].split("\n")[0];
    const manifestDirectory = protocol.slice(0, -"/protocol.md".length);
    temporaryDirectories.push(manifestDirectory);
    const scope = JSON.parse(await readFile(join(manifestDirectory, "scope.json"), "utf8"));
    expect(scope.target).toMatchObject({ head: root, base: null, selectedReferenceSha: root });
    expect(scope.files.map((file: { path: string }) => file.path)).toEqual(["initial.txt"]);
    await git(cwd, "checkout", "-b", "feature");
    await writeFile(join(cwd, "feature"), "feature");
    await git(cwd, "add", ".");
    await git(cwd, "commit", "-m", "feature");
    await git(cwd, "checkout", "main");
    await git(cwd, "merge", "--no-ff", "feature", "-m", "merge");
    await expect(instance.execute(["commit", "HEAD"], ctx)).rejects.toThrow("For merge commits");
  });

  test("uncommitted scope includes every inventory and rejects a racing HEAD", async () => {
    const { cwd, root } = await fixture();
    await writeFile(join(cwd, "initial.txt"), "staged\n");
    await git(cwd, "add", ".");
    await writeFile(join(cwd, "initial.txt"), "staged\nunstaged\n");
    await writeFile(join(cwd, "new\nfile"), "untracked\n");
    const { instance, ctx } = await command(cwd);
    const result = await instance.execute(["uncommitted"], ctx);
    const protocol = (result as string).split("Shared worker protocol:\n")[1].split("\n")[0];
    const directory = protocol.slice(0, -"/protocol.md".length);
    temporaryDirectories.push(directory);
    const scope = JSON.parse(await readFile(join(directory, "scope.json"), "utf8"));
    expect(scope.target).toMatchObject({ checkoutHead: root, sourcePolicy: "live-index-and-working-tree" });
    expect(scope.files.map((file: { path: string }) => file.path).sort()).toEqual(["initial.txt", "new\nfile"]);
    expect(scope.files.find((file: { path: string }) => file.path === "new\nfile").untracked).toBe(true);
    let headReads = 0;
    const racingExec: CustomCommandAPI["exec"] = async (program, args, options) => {
      expect(options?.timeout).toBe(60_000);
      expect(options?.signal).toBeDefined();
      const result = await exec(program, args, options);
      if (args.includes("HEAD^{commit}") && ++headReads === 2) {
        return { ...result, stdout: `${"a".repeat(40)}\n` };
      }
      return result;
    };
    const racing = await command(cwd, (api) => factory({ ...api, exec: racingExec }));
    await expect(racing.instance.execute(["uncommitted"], racing.ctx)).rejects.toThrow("HEAD changed during preparation");
  });

  test("does not fall back to the factory repository when the active directory is outside repositories", async () => {
    const { cwd: factoryCwd } = await fixture();
    const outside = await temporaryDirectory();
    const cwd = join(outside, "nested");
    await mkdir(cwd);
    const discoveryDirectories: Array<string | undefined> = [];
    const boundary: CustomCommandAPI["exec"] = (program, args, options) => {
      discoveryDirectories.push(options?.cwd);
      return exec(program, args, options);
    };
    const { instance, ctx } = await command(cwd, (api) => factory({ ...api, cwd: factoryCwd, exec: boundary }));
    await expect(instance.execute(["mode"], ctx)).rejects.toBeInstanceOf(Error);
    expect(discoveryDirectories).toEqual([cwd]);
    const completions = await instance.getArgumentCompletions!("pr ", cwd);
    expect(completions?.[0].label).toBe("VCS completion failed");
    expect(discoveryDirectories).toEqual([cwd, cwd]);
  });
});
