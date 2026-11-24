import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitRead, readBranches, readFileDiff, readSnapshot, validPath } from "../herdr/mods/review-assistant/git.js";

const worktree = { kind: "worktree" };
const branch = (target) => ({ kind: "branch", target });
const location = (cwd, on = null) => ({ space: "review", cwd, on });
const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };
const directories = [];

function directory() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "review-git-")));
  directories.push(root);
  return root;
}

function run(program, args, cwd) {
  const result = Bun.spawnSync([program, ...args], { cwd, env });
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

function git(cwd, ...args) {
  const result = run("git", args, cwd);
  if (result.code !== 0) throw new Error(result.stderr);
  return result.stdout;
}

const exec = async (program, args, { cwd }) => run(program, args, cwd);
const write = (root, path, text) => writeFileSync(join(root, path), text);

function repo() {
  const root = directory();
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Review Test");
  git(root, "config", "user.email", "review@example.invalid");
  git(root, "config", "commit.gpgSign", "false");
  git(root, "config", "core.hooksPath", "/dev/null");
  return root;
}

function commit(root, message) {
  git(root, "add", "-A");
  git(root, "commit", "-m", message);
  return git(root, "rev-parse", "HEAD").trim();
}

afterEach(() => {
  for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Review Assistant Git snapshots", () => {
  test("preserves staged and unstaged evidence, including reverts, renames, and literal paths", async () => {
    const root = repo();
    write(root, "reverted.txt", "original\n");
    write(root, "both.txt", "both original\n");
    write(root, "rename from.txt", "first\nsecond\nthird\n");
    write(root, "deleted.txt", "will be deleted\n");
    const head = commit(root, "Initial files");
    write(root, "reverted.txt", "staged but then reverted\n");
    write(root, "both.txt", "index version\n");
    write(root, "added.txt", "staged addition\n");
    git(root, "add", "--", "reverted.txt", "both.txt", "added.txt");
    git(root, "mv", "--", "rename from.txt", "rename to.txt");
    write(root, "rename to.txt", "first\nsecond\nthird\nworktree rename edit\n");
    write(root, "reverted.txt", "original\n");
    write(root, "both.txt", "working copy version\n");
    rmSync(join(root, "deleted.txt"));
    const literal = ":(glob)* [odd]\n.txt";
    write(root, literal, "literal untracked addition\n");
    write(root, "empty.txt", "");

    const indexPath = join(root, ".git", "index");
    const index = readFileSync(indexPath);
    const indexTime = statSync(indexPath, { bigint: true }).mtimeNs;
    const status = () => git(root, "--no-optional-locks", "status", "--porcelain=v1", "-z");
    const before = status();
    const snapshot = await readSnapshot(exec, location(root), worktree);
    expect(snapshot).toMatchObject({ root, head, base: head, scope: worktree, on: null });
    expect(snapshot.files).toEqual([
      { path: literal, status: "A" }, { path: "added.txt", status: "A" }, { path: "both.txt", status: "M" },
      { path: "deleted.txt", status: "D" }, { path: "empty.txt", status: "A" },
      { path: "rename to.txt", status: "R", oldPath: "rename from.txt" }, { path: "reverted.txt", status: "M" },
    ]);
    expect(snapshot.dirtyPaths).toEqual([
      literal, "added.txt", "both.txt", "deleted.txt", "empty.txt", "rename from.txt", "rename to.txt", "reverted.txt",
    ]);
    expect(snapshot.patch).toContain("+staged but then reverted");
    expect(snapshot.patch).toContain("-staged but then reverted");
    expect(snapshot.patch).toContain("+index version");
    expect(snapshot.patch).toContain("+working copy version");
    expect(snapshot.patch).toContain("+staged addition");
    expect(snapshot.patch).toContain("-will be deleted");
    expect(snapshot.patch).toContain("+literal untracked addition");
    expect(snapshot.patch).toContain("new file mode");

    const renamed = await readFileDiff(exec, snapshot, "rename to.txt");
    expect(renamed.title).toBe("rename from.txt → rename to.txt");
    expect(renamed.text).toContain("rename from rename from.txt");
    expect(renamed.text).toContain("rename to rename to.txt");
    expect(renamed.text).toContain("+worktree rename edit");
    const untracked = await readFileDiff(exec, snapshot, literal);
    expect(untracked.title).toBe(literal);
    expect(untracked.text).toContain("+literal untracked addition");
    expect(untracked.text).not.toContain("+staged addition");
    expect((await readFileDiff(exec, snapshot, "reverted.txt")).text).toContain("-staged but then reverted");
    expect((await readSnapshot(exec, location(root), worktree)).revision).toBe(snapshot.revision);

    expect(status()).toBe(before);
    expect(readFileSync(indexPath)).toEqual(index);
    expect(statSync(indexPath, { bigint: true }).mtimeNs).toBe(indexTime);
    expect(git(root, "rev-parse", "HEAD").trim()).toBe(head);
    expect(readFileSync(join(root, literal), "utf8")).toBe("literal untracked addition\n");
  });

  test("lists distinct local and remote branch refs while excluding symbolic refs and tags", async () => {
    const root = repo();
    write(root, "base.txt", "base\n");
    const base = commit(root, "Base");
    git(root, "branch", "origin/main");
    git(root, "branch", "z-local");
    git(root, "tag", "only-a-tag");
    write(root, "topic.txt", "source change\n");
    const head = commit(root, "Source change");
    git(root, "update-ref", "refs/remotes/origin/main", head);
    git(root, "update-ref", "refs/remotes/other/HEAD", base);
    git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");

    expect(await readBranches(exec, location(root))).toEqual({
      current: "refs/heads/main",
      branches: [
        { ref: "refs/heads/main", label: "main" },
        { ref: "refs/heads/origin/main", label: "origin/main" },
        { ref: "refs/remotes/origin/main", label: "origin/main" },
        { ref: "refs/remotes/other/HEAD", label: "other/HEAD" },
        { ref: "refs/heads/z-local", label: "z-local" },
      ],
    });
    const local = await readSnapshot(exec, location(root), branch("refs/heads/origin/main"));
    const remote = await readSnapshot(exec, location(root), branch("refs/remotes/origin/main"));
    expect(local).toMatchObject({ base, head, files: [{ path: "topic.txt", status: "A" }] });
    expect(remote).toMatchObject({ base: head, head, files: [] });
  });

  test("rejects detached branch comparisons without blocking worktree review", async () => {
    const root = repo();
    write(root, "base.txt", "base\n");
    const head = commit(root, "Base");
    git(root, "switch", "--detach", "HEAD");
    write(root, "base.txt", "detached worktree edit\n");
    expect(await readBranches(exec, location(root))).toEqual({
      current: null,
      branches: [{ ref: "refs/heads/main", label: "main" }],
    });
    await expect(readSnapshot(exec, location(root), branch("refs/heads/main"))).rejects.toThrow(/Check out a local branch.*Compare/);
    const snapshot = await readSnapshot(exec, location(root), worktree);
    expect(snapshot).toMatchObject({ head, files: [{ path: "base.txt", status: "M" }] });
    expect(snapshot.patch).toContain("+detached worktree edit");
  });

  test("compares the merge base to HEAD and records local changes only as dirty paths", async () => {
    const root = repo();
    write(root, "before.txt", "renamed content\n");
    write(root, "deleted.txt", "delete in the topic\n");
    write(root, "local-name.txt", "working tree rename\n");
    write(root, "local-edit.txt", "working tree original\n");
    const base = commit(root, "Common base");
    git(root, "switch", "-c", "topic");
    git(root, "mv", "before.txt", "after.txt");
    rmSync(join(root, "deleted.txt"));
    write(root, "topic.txt", "topic change\n");
    const head = commit(root, "Topic change");
    git(root, "switch", "main");
    write(root, "ahead-on-main.txt", "target-only change\n");
    const main = commit(root, "Target advance");
    git(root, "update-ref", "refs/remotes/origin/main", main);
    git(root, "tag", "only-a-tag", base);
    git(root, "switch", "topic");
    git(root, "mv", "local-name.txt", "local-renamed.txt");
    write(root, "local-edit.txt", "dirty tracked version\n");
    write(root, "local-only.txt", "dirty untracked version\n");
    write(root, "topic.txt", "dirty on top of topic\n");
    write(root, ".gitattributes", "* -diff\n");

    for (const target of ["main", "refs/heads/main", "origin/main", "refs/remotes/origin/main"]) {
      const snapshot = await readSnapshot(exec, location(root), branch(target));
      expect(snapshot).toMatchObject({ base, head, scope: branch(target) });
      expect(snapshot.files).toEqual([
        { path: "after.txt", status: "R", oldPath: "before.txt" },
        { path: "deleted.txt", status: "D" }, { path: "topic.txt", status: "A" },
      ]);
      expect(snapshot.dirtyPaths).toEqual([".gitattributes", "local-edit.txt", "local-name.txt", "local-only.txt", "local-renamed.txt", "topic.txt"]);
      expect(snapshot.patch).toContain("+topic change");
      expect(snapshot.patch).not.toMatch(/target-only|dirty |local-renamed/);
      expect((await readFileDiff(exec, snapshot, "after.txt")).text).toContain("rename from before.txt");
      expect((await readFileDiff(exec, snapshot, "deleted.txt")).text).toContain("-delete in the topic");
      const topicPreview = await readFileDiff(exec, snapshot, "topic.txt");
      expect(topicPreview.text).toContain("+topic change");
      expect(topicPreview.text).not.toContain("dirty on top of topic");
    }
    for (const target of ["main~0", "main^{commit}", "HEAD", "only-a-tag", "refs/tags/only-a-tag", base]) {
      await expect(readSnapshot(exec, location(root), branch(target))).rejects.toThrow("existing local or remote-tracking branch");
    }
  });

  test("keeps linked worktrees distinct and routes every argv through the source machine", async () => {
    const root = repo();
    write(root, "base.txt", "base\n");
    const head = commit(root, "Base");
    const linked = join(directory(), "linked worktree;literal");
    git(root, "worktree", "add", "-b", "linked", linked);
    const nested = join(linked, "nested cwd");
    mkdirSync(nested);
    write(nested, "changed.txt", "only in linked worktree\n");
    const started = [];
    const routed = async (program, args, options) => {
      started.push({ program, args, ...options });
      return exec(program, args, options);
    };
    const snapshot = await readSnapshot(routed, location(nested, "backend-wsl"), worktree);
    expect(snapshot).toMatchObject({ root: linked, head, base: head, on: "backend-wsl" });
    expect(snapshot.files).toEqual([{ path: "nested cwd/changed.txt", status: "A" }]);
    expect((await readSnapshot(exec, location(root), worktree)).files).toEqual([]);
    expect((await gitRead(routed, snapshot, ["rev-parse", "HEAD"])).stdout.trim()).toBe(head);
    expect(started[0].cwd).toBe(nested);
    expect(started.slice(1).every(({ cwd }) => cwd === linked)).toBe(true);
    const branchReadStart = started.length;
    expect(await readBranches(routed, location(nested, "backend-wsl"))).toEqual({
      current: "refs/heads/linked",
      branches: [{ ref: "refs/heads/linked", label: "linked" }, { ref: "refs/heads/main", label: "main" }],
    });
    expect(started[branchReadStart].cwd).toBe(nested);
    expect(started.slice(branchReadStart + 1).every(({ cwd }) => cwd === linked)).toBe(true);
    for (const { program, on, timeout, args } of started) {
      expect(program).toBe("git");
      expect(on).toBe("backend-wsl");
      expect(timeout).toBeGreaterThan(0);
      expect(args).toContain("--no-optional-locks");
      expect(args).toContain("--no-lazy-fetch");
      expect(args).toContain("--literal-pathspecs");
      expect(args).toContain("core.fsmonitor=false");
      expect(args).not.toContain("fetch");
      if (args.includes("diff")) {
        expect(args).toContain("--no-ext-diff");
        expect(args).toContain("--no-textconv");
      }
    }
  });

  test("opens unborn worktrees and reports non-repositories and unavailable branch scopes", async () => {
    const root = repo();
    expect(await readBranches(exec, location(root))).toEqual({ current: "refs/heads/main", branches: [] });
    write(root, "first.txt", "staged first file\n");
    git(root, "add", "first.txt");
    write(root, "first.txt", "then edited\n");
    write(root, "intent.txt", "intent to add contents\n");
    git(root, "add", "-N", "intent.txt");
    write(root, "untracked.txt", "untracked first file\n");
    const snapshot = await readSnapshot(exec, location(root), worktree);
    expect(snapshot).toMatchObject({ head: null, base: null });
    expect(snapshot.files).toEqual([
      { path: "first.txt", status: "A" }, { path: "intent.txt", status: "A" }, { path: "untracked.txt", status: "A" },
    ]);
    const preview = await readFileDiff(exec, snapshot, "first.txt");
    expect(preview.text).toContain("+staged first file");
    expect(preview.text).toContain("+then edited");
    expect(snapshot.patch.split("Unstaged changes")[0]).not.toContain("intent.txt");
    expect(snapshot.patch).toContain("+intent to add contents");
    await expect(readSnapshot(exec, location(root), branch("main"))).rejects.toThrow("Create a commit");
    await expect(readSnapshot(exec, location(directory()), worktree)).rejects.toThrow("Git working tree");
  });

  test("does not run configured clean, process, external diff, or textconv commands", async () => {
    const root = repo();
    write(root, ".gitattributes", "clean.txt filter=ReviewClean diff=ReviewCase\nprocess.txt filter=ReviewProcess diff=ReviewCase\n");
    write(root, "clean.txt", "clean baseline\n");
    write(root, "process.txt", "process baseline\n");
    commit(root, "Baseline");
    git(root, "config", "filter.ReviewClean.clean", "review-test-clean-command-does-not-exist");
    git(root, "config", "filter.ReviewProcess.process", "review-test-process-command-does-not-exist");
    git(root, "config", "filter.ReviewClean.required", "true");
    git(root, "config", "filter.ReviewProcess.required", "true");
    git(root, "config", "diff.ReviewCase.command", "review-test-diff-command-does-not-exist");
    git(root, "config", "diff.ReviewCase.textconv", "review-test-textconv-command-does-not-exist");
    git(root, "config", "diff.external", "review-test-external-diff-command-does-not-exist");
    write(root, "clean.txt", "changed clean file\n");
    write(root, "process.txt", "changed process file\n");
    const snapshot = await readSnapshot(exec, location(root), worktree);
    expect(snapshot.patch).toContain("+changed clean file");
    expect(snapshot.patch).toContain("+changed process file");
    const preview = await readFileDiff(exec, snapshot, "process.txt");
    expect(preview.text).toContain("+changed process file");
    const againstHead = await readSnapshot(exec, location(root), branch("main"));
    expect(againstHead.patch).toBe("");
    expect(againstHead.dirtyPaths).toEqual(["clean.txt", "process.txt"]);
  });

  test("changes the exact revision for binary edits and bounds large text previews", async () => {
    const root = repo();
    write(root, "large.txt", "old\n");
    commit(root, "Baseline");
    write(root, "local.bin", Uint8Array.of(0, 1, 2, 3));
    const first = await readSnapshot(exec, location(root), worktree);
    expect(first.patch).toContain("GIT binary patch");
    write(root, "local.bin", Uint8Array.of(0, 1, 2, 4));
    const second = await readSnapshot(exec, location(root), worktree);
    expect(second.files).toEqual(first.files);
    expect(second.dirtyPaths).toEqual(first.dirtyPaths);
    expect(second.revision).not.toBe(first.revision);
    write(root, "large.txt", `${"x".repeat(60 * 1024)}\n`);
    const full = await readSnapshot(exec, location(root), worktree);
    const preview = await readFileDiff(exec, full, "large.txt");
    expect(preview.text).toContain("Preview limited");
    expect(preview.text.length).toBeLessThan(60 * 1024);
    expect(full.patch.length).toBeGreaterThan(60 * 1024);
    write(root, "too-large.txt", `${"a".repeat(400 * 1024)}\n`);
    await expect(readSnapshot(exec, location(root), worktree)).rejects.toThrow(/too-large\.txt.*exceeds the review limit/);
  });

  test("rejects inventories that exceed the changed file count budget before reading patches", async () => {
    const root = repo();
    for (let i = 0; i < 257; i++) write(root, `${i}.txt`, "new\n");
    git(root, "add", "-A");
    const inventoryOnly = async (program, args, options) => {
      expect(args).not.toContain("--patch");
      return exec(program, args, options);
    };
    await expect(readSnapshot(inventoryOnly, location(root), worktree)).rejects.toThrow("Changed file inventory exceeds");
  });

  test("rejects a HEAD change observed during snapshot retrieval", async () => {
    const root = repo();
    write(root, "base.txt", "base\n");
    commit(root, "Baseline");
    let moved = false;
    const movingExec = async (program, args, options) => {
      const response = await exec(program, args, options);
      if (!moved && args.at(-1) === "HEAD^{commit}") {
        moved = true;
        git(root, "commit", "--allow-empty", "-m", "Move HEAD");
      }
      return response;
    };
    await expect(readSnapshot(movingExec, location(root), worktree)).rejects.toThrow("Git HEAD changed");
  });

  test("rejects a source branch switch at the same commit during comparison", async () => {
    const root = repo();
    write(root, "base.txt", "base\n");
    const head = commit(root, "Base");
    git(root, "branch", "same-commit");
    const switchingExec = async (program, args, options) => {
      const response = await exec(program, args, options);
      if (args.includes("status")) git(root, "switch", "same-commit");
      return response;
    };
    await expect(readSnapshot(switchingExec, location(root), branch("refs/heads/main")))
      .rejects.toThrow(/checked-out branch changed.*Compare/);
    expect(git(root, "rev-parse", "HEAD").trim()).toBe(head);
  });

  test("accepts literal Git names and rejects traversal or unrepresentable paths", () => {
    for (const path of [":(glob)* [odd]\n.txt", "-", "sub/😺.txt"]) expect(validPath(path)).toBe(true);
    for (const path of [null, "", "/outside", "../outside", "..\\outside", "C:\\outside", "nested//file", "x\0y", "x\uFFFDy"]) {
      expect(validPath(path)).toBe(false);
    }
  });
});
