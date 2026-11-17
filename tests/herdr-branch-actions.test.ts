import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { actionItems, executeBranchAction, readActionContext, readRebaseTodo, type ActionContext } from "../herdr/mods/t3-branches/actions.js";
import { readSnapshot, type Exec, type GitResult } from "../herdr/mods/t3-branches/git.js";
import type { Location } from "../herdr/mods/t3-branches/model.js";

const roots: string[] = [];
const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };
function directory() {
  const root = mkdtempSync(join(tmpdir(), "herdr-branch-actions-"));
  roots.push(root);
  return root;
}
function git(cwd: string, ...argv: string[]): GitResult {
  const result = Bun.spawnSync(["git", ...argv], { cwd, env });
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}
function must(cwd: string, ...argv: string[]) {
  const result = git(cwd, ...argv);
  if (result.code !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}
const exec: Exec = async (program, argv, options) => {
  if (!["git", "env"].includes(program) || options.on) throw new Error("Tests only execute local Git or scoped Git environment commands");
  const result = Bun.spawnSync([program, ...argv], { cwd: options.cwd, env });
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
};
function commit(cwd: string, file: string, content: string, message = file) {
  writeFileSync(join(cwd, file), content);
  must(cwd, "add", "--", file);
  must(cwd, "commit", "-m", message);
  return must(cwd, "rev-parse", "HEAD");
}
function repo(initial = true): Location & { cwd: string } {
  const cwd = directory();
  must(cwd, "init", "-b", "main");
  must(cwd, "config", "user.name", "Branch actions test");
  must(cwd, "config", "user.email", "actions@example.invalid");
  must(cwd, "config", "commit.gpgSign", "false");
  must(cwd, "config", "core.hooksPath", "/dev/null");
  if (initial) commit(cwd, "base.txt", "base\n", "Initial");
  return { space: "test", cwd, on: null };
}
async function context(location: Location, name: string, kind: "local" | "remote" = "local", boundary = exec) {
  const snapshot = await readSnapshot(location, boundary);
  const branch = snapshot.branches.find((item) => item.name === name && item.kind === kind);
  if (!branch) throw new Error(`Missing test branch ${kind} ${name}`);
  return readActionContext(snapshot, branch, boundary);
}
function fork(cwd: string) {
  must(cwd, "branch", "selected");
  commit(cwd, "current.txt", "current\n", "Current work");
  must(cwd, "switch", "selected");
  const target = commit(cwd, "selected.txt", "selected\n", "Selected work");
  must(cwd, "switch", "main");
  return target;
}
function remoteRepo(cwd: string, remote = "origin", name = "topic") {
  const server = directory();
  must(server, "init", "--bare");
  must(cwd, "remote", "add", remote, server);
  must(cwd, "push", remote, `HEAD:refs/heads/${name}`);
  return server;
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("branch action context and menu", () => {
  test("captures exact refs despite branch/tag collisions and uses explicit action labels", async () => {
    const location = repo();
    const target = fork(location.cwd);
    must(location.cwd, "tag", "selected", "main");
    const ctx = await context(location, "selected");
    expect(ctx.target).toBe(target);
    expect(ctx.current).toBe("main");
    expect(actionItems(ctx, false).map((item) => item.type)).toEqual([
      "checkout", "merge", "rebase", "interactiveRebase", "createBranch", "addTag", "deleteBranch", "copy", "pin",
    ]);
    expect(actionItems(ctx, false).find((item) => item.type === "merge")?.label).toBe("Merge selected into main");
    expect(actionItems(ctx, true).at(-1)?.label).toBe("Unpin selected");
    expect(actionItems(ctx, false).find((item) => item.type === "deleteBranch")?.danger).toBe(true);
    const current = await context(location, "main");
    expect(actionItems(current, false).map((item) => item.type)).toEqual(["createBranch", "addTag", "copy", "pin"]);
    must(location.cwd, "switch", "--detach", "HEAD");
    const detached = await context(location, "selected");
    expect(detached.current).toBeNull();
    expect(actionItems(detached, false).map((item) => item.type)).toEqual(["checkout", "createBranch", "addTag", "deleteBranch", "copy", "pin"]);
  });

  test("rejects vanished exact refs and suppresses mutations for unborn HEAD", async () => {
    const location = repo();
    must(location.cwd, "branch", "gone");
    const snapshot = await readSnapshot(location, exec);
    const branch = snapshot.branches.find((item) => item.name === "gone")!;
    must(location.cwd, "branch", "-d", "gone");
    await expect(readActionContext(snapshot, branch, exec)).rejects.toThrow();
    const unborn = repo(false);
    must(unborn.cwd, "fetch", location.cwd, "main:refs/remotes/origin/main");
    const ctx = await context(unborn, "origin/main", "remote");
    expect(ctx.head).toBeNull();
    expect(actionItems(ctx, false).map((item) => item.type)).toEqual(["copy", "pin"]);
  });

  test("routes every action read and mutation through captured machine and root", async () => {
    const location = repo();
    must(location.cwd, "branch", "topic");
    const calls: { cwd: string; on?: string | null; argv: string[] }[] = [];
    const routed: Exec = async (program, argv, options) => {
      calls.push({ ...options, argv });
      return exec(program, argv, { ...options, on: null });
    };
    const ctx = await context({ ...location, on: "workstation" }, "topic", "local", routed);
    await executeBranchAction("createBranch", { name: "machine-created" }, ctx, routed);
    expect(must(location.cwd, "rev-parse", "refs/heads/machine-created")).toBe(ctx.target);
    expect(calls.every((call) => call.cwd === location.cwd && call.on === "workstation")).toBe(true);
  });
});

describe("branch Git mutations", () => {
  test("local checkout keeps symbolic HEAD with same-name tag and path collisions", async () => {
    const location = repo();
    const target = fork(location.cwd);
    must(location.cwd, "tag", "selected", "main");
    writeFileSync(join(location.cwd, "selected"), "untracked path\n");
    await executeBranchAction("checkout", {}, await context(location, "selected"), exec);
    expect(must(location.cwd, "symbolic-ref", "HEAD")).toBe("refs/heads/selected");
    expect(must(location.cwd, "rev-parse", "HEAD")).toBe(target);
    expect(readFileSync(join(location.cwd, "selected"), "utf8")).toBe("untracked path\n");
  });

  test("checkout fails when the local branch disappears instead of restoring a same-name file", async () => {
    const location = repo();
    commit(location.cwd, "topic", "original\n");
    must(location.cwd, "branch", "topic");
    const ctx = await context(location, "topic");
    must(location.cwd, "branch", "-d", "topic");
    writeFileSync(join(location.cwd, "topic"), "unsaved\n");
    await expect(executeBranchAction("checkout", {}, ctx, exec)).rejects.toThrow();
    expect(readFileSync(join(location.cwd, "topic"), "utf8")).toBe("unsaved\n");
    expect(must(location.cwd, "symbolic-ref", "HEAD")).toBe("refs/heads/main");
  });

  test("creates branches and lightweight or annotated tags at selected target, never HEAD", async () => {
    const location = repo();
    const target = fork(location.cwd);
    const ctx = await context(location, "selected");
    await executeBranchAction("createBranch", { name: "feature/nested" }, ctx, exec);
    await executeBranchAction("addTag", { name: "release/light" }, ctx, exec);
    await executeBranchAction("addTag", { name: "release/note", message: "Release message\n\nDetails" }, ctx, exec);
    expect(must(location.cwd, "rev-parse", "refs/heads/feature/nested")).toBe(target);
    expect(must(location.cwd, "rev-parse", "refs/tags/release/light")).toBe(target);
    expect(must(location.cwd, "rev-parse", "refs/tags/release/note^{commit}")).toBe(target);
    expect(must(location.cwd, "cat-file", "-t", "refs/tags/release/note")).toBe("tag");
    expect(must(location.cwd, "for-each-ref", "--format=%(contents)", "refs/tags/release/note")).toBe("Release message\n\nDetails");
    expect(must(location.cwd, "symbolic-ref", "HEAD")).toBe("refs/heads/main");
    await expect(executeBranchAction("createBranch", { name: "feature/nested" }, ctx, exec)).rejects.toThrow();
    await expect(executeBranchAction("addTag", { name: "release/light" }, ctx, exec)).rejects.toThrow();
    expect(must(location.cwd, "rev-parse", "refs/tags/release/light")).toBe(target);
  });

  test("merges the selected exact target into current, including diverged history", async () => {
    const location = repo();
    const target = fork(location.cwd);
    must(location.cwd, "tag", "selected", "main");
    const head = must(location.cwd, "rev-parse", "HEAD");
    await executeBranchAction("merge", {}, await context(location, "selected"), exec);
    expect(must(location.cwd, "rev-parse", "HEAD^1")).toBe(head);
    expect(must(location.cwd, "rev-parse", "HEAD^2")).toBe(target);
    expect(must(location.cwd, "symbolic-ref", "HEAD")).toBe("refs/heads/main");
    expect(readFileSync(join(location.cwd, "selected.txt"), "utf8")).toBe("selected\n");
  });

  test("plain rebase moves current commits onto selected without starting an interactive editor", async () => {
    const location = repo();
    const target = fork(location.cwd);
    must(location.cwd, "config", "sequence.editor", "false");
    await executeBranchAction("rebase", {}, await context(location, "selected"), exec);
    expect(must(location.cwd, "rev-parse", "HEAD^1")).toBe(target);
    expect(must(location.cwd, "symbolic-ref", "HEAD")).toBe("refs/heads/main");
    expect(readFileSync(join(location.cwd, "current.txt"), "utf8")).toBe("current\n");
  });

  test("local deletion requires force for unmerged commits and never deletes current", async () => {
    const location = repo();
    fork(location.cwd);
    const ctx = await context(location, "selected");
    await expect(executeBranchAction("deleteBranch", {}, ctx, exec)).rejects.toThrow();
    expect(git(location.cwd, "show-ref", "--verify", "refs/heads/selected").code).toBe(0);
    await executeBranchAction("deleteBranch", { force: true }, ctx, exec);
    expect(git(location.cwd, "show-ref", "--verify", "refs/heads/selected").code).not.toBe(0);
    await expect(executeBranchAction("deleteBranch", { force: true }, await context(location, "main"), exec)).rejects.toThrow("isn't available");
  });

  test("merge and rebase conflicts remain available for manual resolution", async () => {
    for (const type of ["merge", "rebase"]) {
      const location = repo();
      must(location.cwd, "branch", "selected");
      commit(location.cwd, "base.txt", "current change\n");
      must(location.cwd, "switch", "selected");
      commit(location.cwd, "base.txt", "selected change\n");
      must(location.cwd, "switch", "main");
      await expect(executeBranchAction(type, {}, await context(location, "selected"), exec)).rejects.toThrow();
      expect(must(location.cwd, "ls-files", "--unmerged")).not.toBe("");
      expect(readFileSync(join(location.cwd, "base.txt"), "utf8")).toContain("<<<<<<<");
      expect(existsSync(join(location.cwd, ".git", type === "merge" ? "MERGE_HEAD" : "rebase-merge"))).toBe(true);
    }
  });
});

describe("remote branch routing", () => {
  test("uses longest configured slash-containing remote and creates the chosen tracking branch", async () => {
    const location = repo();
    const server = remoteRepo(location.cwd, "team/origin", "feature/topic");
    // Git's remote-add command rejects overlapping names; existing config can still contain both.
    must(location.cwd, "config", "remote.team.url", server);
    must(location.cwd, "config", "remote.team.fetch", "+refs/heads/*:refs/remotes/team-mirror/*");
    must(location.cwd, "branch", "feature/topic");
    const ctx = await context(location, "team/origin/feature/topic", "remote");
    expect(ctx.remote).toBe("team/origin");
    expect(ctx.remoteBranch).toBe("feature/topic");
    expect(ctx.localExists).toBe(true);
    await expect(executeBranchAction("checkout", {}, ctx, exec)).rejects.toThrow();
    expect(must(location.cwd, "symbolic-ref", "HEAD")).toBe("refs/heads/main");
    await executeBranchAction("checkout", { name: "local/topic" }, ctx, exec);
    expect(must(location.cwd, "symbolic-ref", "HEAD")).toBe("refs/heads/local/topic");
    expect(must(location.cwd, "config", "branch.local/topic.remote")).toBe("team/origin");
    expect(must(location.cwd, "config", "branch.local/topic.merge")).toBe("refs/heads/feature/topic");
    expect(must(location.cwd, "rev-parse", "@{upstream}")).toBe(ctx.target);
  });

  test("remote checkout defaults to the remote branch name, not its remote prefix", async () => {
    const location = repo();
    remoteRepo(location.cwd);
    const ctx = await context(location, "origin/topic", "remote");
    expect(ctx.localExists).toBe(false);
    await executeBranchAction("checkout", {}, ctx, exec);
    expect(must(location.cwd, "symbolic-ref", "HEAD")).toBe("refs/heads/topic");
    expect(must(location.cwd, "config", "branch.topic.remote")).toBe("origin");
    expect(must(location.cwd, "config", "branch.topic.merge")).toBe("refs/heads/topic");
  });

  test("deletes the server branch rather than merely its local tracking ref", async () => {
    const location = repo();
    const server = remoteRepo(location.cwd, "team/origin", "feature/topic");
    const decoy = directory();
    must(decoy, "init", "--bare");
    must(location.cwd, "config", "remote.team.url", decoy);
    must(location.cwd, "config", "remote.team.fetch", "+refs/heads/*:refs/remotes/team-mirror/*");
    await executeBranchAction("deleteBranch", {}, await context(location, "team/origin/feature/topic", "remote"), exec);
    expect(git(server, "show-ref", "--verify", "refs/heads/feature/topic").code).not.toBe(0);
    expect(git(location.cwd, "show-ref", "--verify", "refs/remotes/team/origin/feature/topic").code).not.toBe(0);
    expect(must(location.cwd, "symbolic-ref", "HEAD")).toBe("refs/heads/main");
  });

  test("server-side changes reject deletion through an exact-tip lease", async () => {
    const location = repo();
    const server = remoteRepo(location.cwd);
    const ctx = await context(location, "origin/topic", "remote");
    const other = commit(location.cwd, "later.txt", "later\n");
    // Restore the captured local HEAD while advancing only the server tip.
    must(location.cwd, "update-ref", "refs/heads/main", ctx.head!);
    must(server, "fetch", location.cwd, `${other}:refs/heads/topic`);
    await expect(executeBranchAction("deleteBranch", {}, ctx, exec)).rejects.toThrow();
    expect(must(server, "rev-parse", "refs/heads/topic")).toBe(other);
    expect(must(location.cwd, "rev-parse", "refs/remotes/origin/topic")).toBe(ctx.target);
  });

  test("orphan remote refs omit checkout and deletion, and removed configured remotes reject stale actions", async () => {
    const location = repo();
    must(location.cwd, "update-ref", "refs/remotes/orphan/topic", "HEAD");
    const orphan = await context(location, "orphan/topic", "remote");
    expect(orphan.remote).toBeNull();
    expect(actionItems(orphan, false).some((item) => ["checkout", "deleteBranch"].includes(item.type))).toBe(false);
    remoteRepo(location.cwd);
    const ctx = await context(location, "origin/topic", "remote");
    must(location.cwd, "config", "--remove-section", "remote.origin");
    await expect(executeBranchAction("deleteBranch", {}, ctx, exec)).rejects.toThrow("changed");
  });
});

describe("action preflight safety", () => {
  test("rejects changed HEAD, changed current branch, and moved selected target", async () => {
    for (const change of ["head", "current", "target"]) {
      const location = repo();
      must(location.cwd, "branch", "selected");
      const ctx = await context(location, "selected");
      if (change === "head") commit(location.cwd, "later.txt", "later\n");
      if (change === "current") { must(location.cwd, "branch", "other"); must(location.cwd, "switch", "other"); }
      if (change === "target") {
        const newTip = commit(location.cwd, "later.txt", "later\n");
        must(location.cwd, "update-ref", "refs/heads/main", ctx.head!);
        must(location.cwd, "update-ref", "refs/heads/selected", newTip);
      }
      await expect(executeBranchAction("createBranch", { name: "must-not-exist" }, ctx, exec)).rejects.toThrow("changed");
      expect(git(location.cwd, "show-ref", "--verify", "refs/heads/must-not-exist").code).not.toBe(0);
    }
  });

  test("accepts a JSON-roundtripped action context", async () => {
    const location = repo();
    const target = fork(location.cwd);
    const ctx: ActionContext = JSON.parse(JSON.stringify(await context(location, "selected")));
    await executeBranchAction("createBranch", { name: "roundtrip-created" }, ctx, exec);
    expect(must(location.cwd, "rev-parse", "refs/heads/roundtrip-created")).toBe(target);
    expect(must(location.cwd, "symbolic-ref", "HEAD")).toBe("refs/heads/main");
  });

  test("rejects malformed serialized context fields without creating refs", async () => {
    const location = repo();
    must(location.cwd, "branch", "selected");
    const original = await context(location, "selected");
    const changes: ((ctx: ActionContext) => void)[] = [
      (ctx) => { ctx.snapshot.root = ""; },
      (ctx) => { ctx.snapshot.on = ""; },
      (ctx) => { ctx.head = "not-an-object-id"; },
      (ctx) => { ctx.target = "not-an-object-id"; },
      (ctx) => { ctx.current = ""; },
      (ctx) => { ctx.branch.ref = "refs/tags/selected"; },
      (ctx) => { ctx.remote = "unexpected"; ctx.remoteBranch = "selected"; },
    ];
    for (const change of changes) {
      const ctx: ActionContext = JSON.parse(JSON.stringify(original));
      change(ctx);
      await expect(executeBranchAction("createBranch", { name: "must-not-exist" }, ctx, exec)).rejects.toThrow();
      expect(git(location.cwd, "show-ref", "--verify", "refs/heads/must-not-exist").code).not.toBe(0);
    }
  });

  test("validates names, values, and unsupported action types without changing refs", async () => {
    const location = repo();
    must(location.cwd, "branch", "selected");
    const ctx = await context(location, "selected");
    for (const name of ["", "-f", "bad name", "a..b", "a.lock", "topic\nexec touch pwned", "@{-1}", "bad\0name", " leading"]) {
      await expect(executeBranchAction("createBranch", { name }, ctx, exec)).rejects.toThrow();
      await expect(executeBranchAction("addTag", { name }, ctx, exec)).rejects.toThrow();
    }
    for (const type of ["copy", "pin", "rename", "push", "unknown"]) {
      await expect(executeBranchAction(type, {}, ctx, exec)).rejects.toThrow();
    }
    await expect(executeBranchAction("merge", { force: true }, ctx, exec)).rejects.toThrow("unsupported");
    await expect(executeBranchAction("addTag", { name: "bad-message", message: "bad\0message" }, ctx, exec)).rejects.toThrow("unsupported");
    await expect(executeBranchAction("checkout", { name: "other" }, ctx, exec)).rejects.toThrow();
    expect(must(location.cwd, "for-each-ref", "--format=%(refname)")).toBe("refs/heads/main\nrefs/heads/selected");
    expect(existsSync(join(location.cwd, "pwned"))).toBe(false);
  });

  test("checks the repository root rather than trusting a reused path", async () => {
    const location = repo();
    must(location.cwd, "branch", "selected");
    const ctx = await context(location, "selected");
    const nested = join(location.cwd, "nested");
    const changedRoot: Exec = async (program, argv, options) => argv.includes("--show-toplevel")
      ? { code: 0, stdout: nested + "\n", stderr: "" } : exec(program, argv, options);
    await expect(executeBranchAction("merge", {}, ctx, changedRoot)).rejects.toThrow("changed");
  });
});

async function linearHistory(): Promise<{ location: Location & { cwd: string }; ctx: ActionContext; hashes: string[]; target: string }> {
  const location = repo();
  must(location.cwd, "branch", "selected");
  const hashes = [commit(location.cwd, "one.txt", "one\n", "One"), commit(location.cwd, "two.txt", "two\n", "Two"), commit(location.cwd, "three.txt", "three\n", "Three")];
  must(location.cwd, "switch", "selected");
  const target = commit(location.cwd, "onto.txt", "onto\n", "Onto");
  must(location.cwd, "switch", "main");
  return { location, ctx: await context(location, "selected"), hashes, target };
}

describe("interactive rebase", () => {
  test("generates a full-ID todo for current commits only", async () => {
    const { ctx, hashes } = await linearHistory();
    const todo = await readRebaseTodo(ctx, exec);
    expect(todo).toBe(hashes.map((hash, index) => `pick ${hash} ${["One", "Two", "Three"][index]}\n`).join(""));
  });

  test("supports reordering and dropping while maintaining current branch and selected base", async () => {
    const { location, ctx, hashes, target } = await linearHistory();
    await readRebaseTodo(ctx, exec);
    await executeBranchAction("interactiveRebase", { todo: `pick ${hashes[2]}\ndrop ${hashes[1]}\npick ${hashes[0]}\n` }, ctx, exec);
    expect(must(location.cwd, "log", "--reverse", "--format=%s", `${target}..HEAD`)).toBe("Three\nOne");
    expect(must(location.cwd, "rev-parse", "HEAD~2")).toBe(target);
    expect(must(location.cwd, "symbolic-ref", "HEAD")).toBe("refs/heads/main");
    expect(existsSync(join(location.cwd, "two.txt"))).toBe(false);
  });

  test("squash and fixup use the default commit message without another editor", async () => {
    for (const command of ["squash", "fixup"]) {
      const { location, ctx, hashes, target } = await linearHistory();
      await readRebaseTodo(ctx, exec);
      await executeBranchAction("interactiveRebase", { todo: `pick ${hashes[0]}\n${command} ${hashes[1]}\ndrop ${hashes[2]}\n` }, ctx, exec);
      expect(must(location.cwd, "rev-list", "--count", `${target}..HEAD`)).toBe("1");
      expect(must(location.cwd, "log", "-1", "--format=%s")).toBe("One");
      expect(must(location.cwd, "log", "-1", "--format=%B").includes("Two")).toBe(command === "squash");
      expect(readFileSync(join(location.cwd, "two.txt"), "utf8")).toBe("two\n");
    }
  });

  test("allows dropping every eligible commit", async () => {
    const { location, ctx, hashes, target } = await linearHistory();
    await readRebaseTodo(ctx, exec);
    await executeBranchAction("interactiveRebase", { todo: hashes.map((hash) => `drop ${hash}`).join("\n") }, ctx, exec);
    expect(must(location.cwd, "rev-parse", "HEAD")).toBe(target);
    expect(must(location.cwd, "symbolic-ref", "HEAD")).toBe("refs/heads/main");
  });

  test("rejects unsafe commands, unknown or duplicate IDs, omissions, and first squash/fixup", async () => {
    const { location, ctx, hashes } = await linearHistory();
    if (ctx.head === null) throw new Error("Expected a committed fixture HEAD");
    const original = await readRebaseTodo(ctx, exec);
    for (const todo of [
      original + "exec touch pwned\n", original.replace("pick", "edit"), original.replace("pick", "reword"),
      original + "break\n", original.replace(hashes[0], "a".repeat(40)), original.replace(hashes[0], hashes[1]),
      original.replace(hashes[0], hashes[0].slice(0, 7)), original.split("\n").slice(1).join("\n"),
      original.replace("pick", "squash"), original.replace("pick", "fixup"),
      original.replace(`pick ${hashes[0]}`, `pick ${hashes[0]}; touch pwned`), original + "\0exec touch pwned",
    ]) {
      await expect(executeBranchAction("interactiveRebase", { todo }, ctx, exec)).rejects.toThrow();
      expect(must(location.cwd, "rev-parse", "HEAD")).toBe(ctx.head);
    }
    expect(existsSync(join(location.cwd, "pwned"))).toBe(false);
  });

  test("editable descriptions never execute shell content", async () => {
    const { location, ctx, hashes } = await linearHistory();
    await readRebaseTodo(ctx, exec);
    const todo = hashes.map((hash) => `pick ${hash} '; touch pwned; $(touch pwned) \`touch pwned\``).join("\n");
    await executeBranchAction("interactiveRebase", { todo }, ctx, exec);
    expect(existsSync(join(location.cwd, "pwned"))).toBe(false);
    expect(must(location.cwd, "rev-list", "--count", `${ctx.target}..HEAD`)).toBe("3");
  });

  test("rejects zero commits and unsupported merge history without changing HEAD", async () => {
    const location = repo();
    must(location.cwd, "branch", "selected");
    await expect(readRebaseTodo(await context(location, "selected"), exec)).rejects.toThrow("no current-branch commits");
    must(location.cwd, "branch", "side");
    commit(location.cwd, "main.txt", "main\n");
    must(location.cwd, "switch", "side");
    commit(location.cwd, "side.txt", "side\n");
    must(location.cwd, "switch", "main");
    must(location.cwd, "merge", "--no-ff", "--no-edit", "side");
    const ctx = await context(location, "selected");
    if (ctx.head === null) throw new Error("Expected a committed fixture HEAD");
    await expect(readRebaseTodo(ctx, exec)).rejects.toThrow("merge commits");
    expect(must(location.cwd, "rev-parse", "HEAD")).toBe(ctx.head);
  });

  test("requires a captured todo and rejects history changes before confirmation", async () => {
    const { location, ctx } = await linearHistory();
    await expect(executeBranchAction("interactiveRebase", { todo: "" }, ctx, exec)).rejects.toThrow("Open the interactive rebase todo");
    const todo = await readRebaseTodo(ctx, exec);
    commit(location.cwd, "later.txt", "later\n");
    await expect(executeBranchAction("interactiveRebase", { todo }, ctx, exec)).rejects.toThrow("changed");
    expect(existsSync(join(location.cwd, ".git", "rebase-merge"))).toBe(false);
  });
});

describe("serialized interactive context", () => {
  test("preserves captured todo history across JSON roundtrips", async () => {
    const { location, ctx, target } = await linearHistory();
    const dialogContext: ActionContext = JSON.parse(JSON.stringify(ctx));
    const todo = await readRebaseTodo(dialogContext, exec);
    expect(typeof dialogContext.rebaseHistory).toBe("string");
    const executionContext: ActionContext = JSON.parse(JSON.stringify(dialogContext));
    await executeBranchAction("interactiveRebase", { todo }, executionContext, exec);
    expect(must(location.cwd, "rev-list", "--count", `${target}..HEAD`)).toBe("3");
    expect(must(location.cwd, "rev-parse", "HEAD~3")).toBe(target);
    expect(must(location.cwd, "symbolic-ref", "HEAD")).toBe("refs/heads/main");
  });

  test("rejects malformed serialized history instead of trusting its captured commit list", async () => {
    const { location, ctx } = await linearHistory();
    if (ctx.head === null) throw new Error("Expected a committed fixture HEAD");
    const todo = await readRebaseTodo(ctx, exec);
    const captured = ctx.rebaseHistory;
    for (const history of ["not-json", "[]", JSON.stringify([{ hash: ctx.head }])]) {
      ctx.rebaseHistory = history;
      await expect(executeBranchAction("interactiveRebase", { todo }, ctx, exec)).rejects.toThrow("changed");
      expect(must(location.cwd, "rev-parse", "HEAD")).toBe(ctx.head);
    }
    ctx.rebaseHistory = captured;
  });
});

describe("interactive history identity", () => {
  test("rejects replacement history even when HEAD and selected full-ref tips haven't changed", async () => {
    const { location, ctx, hashes } = await linearHistory();
    if (ctx.head === null) throw new Error("Expected a committed fixture HEAD");
    const todo = await readRebaseTodo(ctx, exec);
    const replacement = must(location.cwd, "commit-tree", `${hashes[0]}^{tree}`, "-p", `${hashes[0]}^`, "-m", "Replaced history");
    must(location.cwd, "replace", hashes[0], replacement);
    await expect(executeBranchAction("interactiveRebase", { todo }, ctx, exec)).rejects.toThrow("changed");
    expect(must(location.cwd, "rev-parse", "HEAD")).toBe(ctx.head);
    expect(must(location.cwd, "rev-parse", ctx.branch.ref)).toBe(ctx.target);
    expect(existsSync(join(location.cwd, ".git", "rebase-merge"))).toBe(false);
  });
});

describe("interactive editor invocation", () => {
  test("overrides inherited editors only for the routed rebase process and applies the supplied todo", async () => {
    const { location, hashes, target } = await linearHistory();
    const inherited = { ...env, GIT_SEQUENCE_EDITOR: "false", GIT_EDITOR: "false" };
    const calls: { program: string; argv: string[]; cwd: string; on?: string | null }[] = [];
    const routed: Exec = async (program, argv, options) => {
      calls.push({ program, argv, ...options });
      const result = Bun.spawnSync([program, ...argv], { cwd: options.cwd, env: inherited });
      return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
    };
    const ctx = await context({ ...location, on: "remote-workstation" }, "selected", "local", routed);
    await readRebaseTodo(ctx, routed);
    await executeBranchAction("interactiveRebase", {
      todo: `pick ${hashes[0]}\nsquash ${hashes[1]}\ndrop ${hashes[2]}\n`,
    }, ctx, routed);
    expect(must(location.cwd, "rev-list", "--count", `${target}..HEAD`)).toBe("1");
    expect(must(location.cwd, "log", "-1", "--format=%B")).toContain("Two");
    expect(existsSync(join(location.cwd, "three.txt"))).toBe(false);
    expect(must(location.cwd, "symbolic-ref", "HEAD")).toBe("refs/heads/main");
    expect(calls.every((call) => call.cwd === location.cwd && call.on === "remote-workstation")).toBe(true);
    expect(calls.filter((call) => call.program === "env")).toHaveLength(1);
    const invocation = calls.find((call) => call.program === "env")!;
    expect(invocation.argv[0].startsWith("GIT_SEQUENCE_EDITOR=")).toBe(true);
    expect(invocation.argv.slice(1, 3)).toEqual(["GIT_EDITOR=true", "git"]);
    expect(inherited.GIT_SEQUENCE_EDITOR).toBe("false");
    expect(inherited.GIT_EDITOR).toBe("false");
  });
});
