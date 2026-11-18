import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseStatus, groupsOf, fileTree, treeRows, commitArgs, displayPath, parsePrevious, unifiedFiles } from "../herdr/mods/t3-changes/model.js";
import { readSnapshot, perform, type Exec } from "../herdr/mods/t3-changes/git.js";
import { ChangesController } from "../herdr/mods/t3-changes/controller.js";
import { resolveContext } from "../herdr/mods/t3-changes/context.js";
import type { Location } from "../herdr/mods/t3-changes/model.js";

const roots: string[] = [];
const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };
function git(cwd: string, ...argv: string[]) {
  const result = Bun.spawnSync(["git", ...argv], { cwd, env });
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}
const exec = async (program: string, argv: string[], options: { cwd: string; on?: string | null }) => {
  if (program !== "git" || options.on) throw new Error("Tests only execute local Git");
  return git(options.cwd, ...argv);
};
function must(cwd: string, ...args: string[]) {
  const result = git(cwd, ...args);
  if (result.code) throw new Error(result.stderr);
  return result.stdout;
}
function repo(initial = true) {
  const root = mkdtempSync(join(tmpdir(), "herdr-changes-")); roots.push(root);
  must(root, "init", "-b", "main");
  must(root, "config", "user.name", "Changes test"); must(root, "config", "user.email", "changes@example.invalid");
  must(root, "config", "commit.gpgSign", "false"); must(root, "config", "core.hooksPath", "/dev/null");
  if (initial) { writeFileSync(join(root, "tracked.txt"), "base\n"); must(root, "add", "."); must(root, "commit", "-m", "Initial"); }
  return { cwd: root, on: null };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("Changes calculations", () => {
  test("NUL paths, conflict groups, and two-sided files stay distinct", () => {
    const path = "src/odd\n[abc]*.txt";
    const files = parseStatus(`MM ${path}\0?? new.txt\0UU conflict.txt\0`), groups = groupsOf(files);
    expect(groups.staged.map((f) => f.path)).toEqual([path]);
    expect(groups.unstaged.map((f) => f.path)).toEqual([path, "new.txt", "conflict.txt"]);
    expect(groups.unstaged[2].status).toBe("U"); expect(displayPath(path)).toContain("\\n");
    expect(treeRows(fileTree(groups.unstaged), new Set(["unstaged:src"]), "unstaged").map((r) => r.path)).toEqual(["src", "conflict.txt", "new.txt"]);
    expect(() => parseStatus(" M incomplete")).toThrow();
    expect(() => parseStatus(" M ../outside\0")).toThrow();
  });
  test("file-to-directory changes preserve both nodes and every changed file", () => {
    const files = unifiedFiles({ groups: groupsOf(parseStatus(" D a\0?? a/b\0")) });
    const tree = fileTree(files), rows = treeRows(tree, new Set(), "changes");
    expect(tree.map((node) => [node.path, Boolean(node.file)])).toEqual([["a", false], ["a", true]]);
    expect(rows.filter((row) => row.file).map((row) => row.path).sort()).toEqual(["a", "a/b"]);
    expect(rows.map((row) => [row.path, row.depth])).toEqual([["a", 0], ["a/b", 1], ["a", 0]]);
    const collapsed = treeRows(tree, new Set(["changes:a"]), "changes");
    expect(collapsed.map((row) => [row.path, Boolean(row.file)])).toEqual([["a", false], ["a", true]]);
  });

  test("amend previous-only paths cannot hide changed descendants", () => {
    const groups = groupsOf(parseStatus("?? a/b\0"));
    const previous = parsePrevious("D\0a\0");
    for (const files of [unifiedFiles({ groups }, previous), [...previous, ...groups.unstaged]]) {
      const tree = fileTree(files), rows = treeRows(tree, new Set(), "changes");
      expect(tree.map((node) => [node.path, Boolean(node.file)])).toEqual([["a", false], ["a", true]]);
      expect(rows.filter((row) => row.file).map((row) => row.path).sort()).toEqual(["a", "a/b"]);
      expect(tree[0].children?.map((node) => node.path)).toEqual(["a/b"]);
    }
  });

  test("commit arguments preserve one complete multiline message verbatim", () => {
    const message = "\n  Keep spaces  \n\n# Keep this comment\nSecond detail\t \n\n";
    expect(commitArgs(message)).toEqual(["commit", "--cleanup=verbatim", "-m", message]);
    expect(commitArgs("First line\nSecond line")).toEqual(["commit", "--cleanup=verbatim", "-m", "First line\nSecond line"]);
    expect(() => commitArgs(" \t\r\n ")).toThrow("Enter a commit message");
    expect(() => commitArgs("Message\0body")).toThrow("NUL");
  });
});

describe("Changes real Git boundary", () => {
  test("loads both groups and commits literal special filenames only", async () => {
    const context = repo(), root = context.cwd, path = "-odd [x]*\nname.txt";
    writeFileSync(join(root, "tracked.txt"), "index\n"); must(root, "add", "tracked.txt");
    writeFileSync(join(root, "tracked.txt"), "worktree\n");
    writeFileSync(join(root, path), "literal\n"); writeFileSync(join(root, "unrelated.txt"), "leave untracked\n");
    const snapshot = await readSnapshot(context, exec);
    expect(snapshot.groups.staged[0].path).toBe("tracked.txt");
    expect(snapshot.groups.unstaged.find((f) => f.path === "tracked.txt")).toBeDefined();
    const untracked = snapshot.groups.unstaged.find((file) => file.path === path);
    if (!untracked) throw new Error("Expected literal untracked path");
    expect((await perform(snapshot, { type: "commit", paths: [path], message: "Literal" }, exec)).ok).toBe(true);
    expect(must(root, "show", `HEAD:${path}`)).toBe("literal\n");
    expect(must(root, "show", "HEAD:tracked.txt")).toBe("base\n");
    expect((await readSnapshot(context, exec)).groups.unstaged.some((f) => f.path === "unrelated.txt")).toBe(true);
  });

  test("rolls back selected additions safely in an unborn index", async () => {
    const context = repo(false), root = context.cwd;
    writeFileSync(join(root, "new.txt"), "index\n"); must(root, "add", "new.txt");
    writeFileSync(join(root, "new.txt"), "newer work\n");
    writeFileSync(join(root, "keep.txt"), "keep\n"); must(root, "add", "keep.txt");
    const snapshot = await readSnapshot(context, exec);
    expect(snapshot.head).toBeNull();
    expect((await perform(snapshot, { type: "rollback", paths: ["new.txt"], confirmed: true }, exec)).ok).toBe(true);
    expect((await readSnapshot(context, exec)).groups.staged.map((file) => file.path)).toEqual(["keep.txt"]);
    expect(readFileSync(join(root, "keep.txt"), "utf8")).toBe("keep\n");
  });

  test("commit preserves the exact multiline message and includes the full selected workingtree file", async () => {
    const context = repo(), root = context.cwd;
    writeFileSync(join(root, "tracked.txt"), "staged only\n"); must(root, "add", "tracked.txt");
    writeFileSync(join(root, "tracked.txt"), "not committed\n");
    const snapshot = await readSnapshot(context, exec);
    const message = "\n  Subject with spaces  \n\n# Keep this line\nFirst detail\nSecond detail\t \n\n";
    expect((await perform(snapshot, { type: "commit", message, paths: ["tracked.txt"] }, exec)).ok).toBe(true);
    expect(must(root, "show", "HEAD:tracked.txt")).toBe("not committed\n");
    const object = must(root, "cat-file", "commit", "HEAD");
    expect(object.slice(object.indexOf("\n\n") + 2)).toBe(message);
    expect((await readSnapshot(context, exec)).files).toHaveLength(0);
  });

  test("preflight rejects branch changes and focus changes before Git writes", async () => {
    const context = repo(), root = context.cwd;
    writeFileSync(join(root, "tracked.txt"), "changed\n");
    const snapshot = await readSnapshot(context, exec);
    must(root, "switch", "-c", "other");
    expect((await perform(snapshot, { type: "commit", paths: ["tracked.txt"], message: "No" }, exec)).ok).toBe(false);
    expect((await readSnapshot(context, exec)).groups.staged).toHaveLength(0);
    const fresh = await readSnapshot(context, exec);
    let focused = true;
    const switchedExec: Exec = async (program, args, options) => { const result = await exec(program, args, options); focused = false; return result; };
    expect((await perform(fresh, { type: "commit", paths: ["tracked.txt"], message: "No" }, switchedExec, () => focused)).ok).toBe(false);
    expect((await readSnapshot(context, exec)).groups.staged).toHaveLength(0);
  });

  test("conflicts remain visible and block commit, stash, and rollback", async () => {
    const context = repo(), root = context.cwd;
    must(root, "switch", "-c", "side"); writeFileSync(join(root, "tracked.txt"), "side\n"); must(root, "commit", "-am", "Side");
    must(root, "switch", "main"); writeFileSync(join(root, "tracked.txt"), "main\n"); must(root, "commit", "-am", "Main");
    expect(git(root, "merge", "side").code).not.toBe(0);
    const snapshot = await readSnapshot(context, exec);
    expect(snapshot.groups.unstaged[0].status).toBe("U");
    for (const action of [
      { type: "stash" as const, paths: ["tracked.txt"] },
      { type: "rollback" as const, paths: ["tracked.txt"], confirmed: true },
      { type: "commit" as const, paths: ["tracked.txt"], message: "No" },
    ]) expect((await perform(snapshot, action, exec)).ok).toBe(false);
  });

  test("controller refreshes file status without preview reads and isolates drafts", async () => {
    const first = repo(), second = repo(); let context = first;
    writeFileSync(join(first.cwd, "tracked.txt"), "first edit\n");
    const calls: string[][] = [];
    const listing: Exec = async (program, argv, options) => { calls.push(argv); return exec(program, argv, options); };
    const controller = new ChangesController({ exec: listing, location: () => context });
    const message = "Keep my draft\n\nWith its detail";
    await controller.refresh(); controller.setDraft(message);
    writeFileSync(join(first.cwd, "tracked.txt"), "second edit\n");
    await controller.refresh();
    expect(controller.files().map((file) => file.path)).toEqual(["tracked.txt"]);
    expect(calls.some((argv) => argv.includes("diff") || argv.includes("show") || argv.includes("cat-file") || argv.includes("ls-files"))).toBe(false);
    context = second; await controller.refresh(); expect(controller.draft().message).toBe("");
    context = first; await controller.refresh(); expect(controller.draft().message).toBe(message);
    await controller.mutate({ type: "commit" }); expect(controller.draft().message).toBe(message);
    expect(controller.error).not.toBeNull();
    controller.toggleFiles(["tracked.txt"]); await controller.mutate({ type: "commit" });
    expect(controller.draft().message).toBe(""); controller.close();
  });

  test("failed Git hooks retain the complete draft and successful commits clear it", async () => {
    const context = repo(), root = context.cwd, message = "Preserve this message\n\n# Including comments\n  detail  \n\n";
    writeFileSync(join(root, "tracked.txt"), "ready to commit\n"); must(root, "add", "tracked.txt");
    const hook = join(root, ".git", "hooks", "pre-commit");
    must(root, "config", "core.hooksPath", ".git/hooks");
    writeFileSync(hook, "#!/bin/sh\necho 'Hook rejected this commit' >&2\nexit 1\n"); chmodSync(hook, 0o755);
    const controller = new ChangesController({ exec, location: () => context });
    try {
      await controller.refresh(); controller.toggleFiles(["tracked.txt"]); controller.setDraft(message);
      const before = must(root, "rev-parse", "HEAD");
      await controller.mutate({ type: "commit" });
      expect(controller.error).toContain("Hook rejected this commit");
      expect(controller.draft()).toEqual({ message });
      expect(must(root, "rev-parse", "HEAD")).toBe(before);
      expect(controller.snapshot?.groups.staged).toHaveLength(1);
      writeFileSync(hook, "#!/bin/sh\nexit 0\n");
      await controller.mutate({ type: "commit" });
      expect(controller.error).toBeNull();
      expect(controller.draft()).toEqual({ message: "" });
      const object = must(root, "cat-file", "commit", "HEAD");
      expect(object.slice(object.indexOf("\n\n") + 2)).toBe(message);
    } finally { controller.close(); }
  });

  test("successful commits do not erase message edits made while Git is running", async () => {
    const context = repo(), root = context.cwd;
    writeFileSync(join(root, "tracked.txt"), "ready to commit\n"); must(root, "add", "tracked.txt");
    const entered = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
    const delayed: Exec = async (program, argv, options) => {
      if (argv.includes("commit")) { entered.resolve(); await resume.promise; }
      return exec(program, argv, options);
    };
    const controller = new ChangesController({ exec: delayed, location: () => context });
    await controller.refresh();
    controller.toggleFiles(["tracked.txt"]);
    const committed = "Original message\n\nOriginal detail\n", edited = "Next message\n\nTyped during a hook\n";
    controller.setDraft(committed);
    const pending = controller.mutate({ type: "commit" });
    try {
      await entered.promise;
      expect(controller.busy).toBe(true);
      controller.setDraft(edited);
      resume.resolve(); await pending;
      expect(controller.error).toBeNull();
      expect(controller.draft()).toEqual({ message: edited });
      const object = must(root, "cat-file", "commit", "HEAD");
      expect(object.slice(object.indexOf("\n\n") + 2)).toBe(committed);
    } finally {
      resume.resolve(); await pending; controller.close();
    }
  });

  test("refresh keeps filenames and inclusion stable until status arrives without loading content", async () => {
    const context = repo();
    writeFileSync(join(context.cwd, "tracked.txt"), "displayed edit\n");
    const entered = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
    let hold = false;
    const calls: string[][] = [];
    const delayed: Exec = async (program, argv, options) => {
      calls.push(argv);
      const result = await exec(program, argv, options);
      if (hold && argv.includes("status")) { hold = false; entered.resolve(); await resume.promise; }
      return result;
    };
    const controller = new ChangesController({ exec: delayed, location: () => context });
    await controller.refresh(); controller.toggleFiles(["tracked.txt"]);
    writeFileSync(join(context.cwd, "arriving.txt"), "new file content\n");
    hold = true;
    const refresh = controller.refresh();
    try {
      await entered.promise;
      expect(controller.loading).toBe(true);
      expect(controller.files().map((file) => file.path)).toEqual(["tracked.txt"]);
      expect([...controller.checked]).toEqual(["tracked.txt"]);
      resume.resolve(); await refresh;
      expect(controller.loading).toBe(false);
      expect(controller.files().map((file) => file.path).sort()).toEqual(["arriving.txt", "tracked.txt"]);
      expect([...controller.checked]).toEqual(["tracked.txt"]);
      expect(controller.checked.has("arriving.txt")).toBe(false);
      const before = calls.length;
      controller.toggleFiles(["arriving.txt"]);
      expect(controller.checked.has("arriving.txt")).toBe(true);
      expect(calls).toHaveLength(before);
      expect(calls.some((argv) => argv.includes("diff") || argv.includes("show") || argv.includes("cat-file") || argv.includes("ls-files"))).toBe(false);
    } finally { resume.resolve(); await refresh; controller.close(); }
  });

  test("changing repository context clears filenames and inclusion before the new snapshot arrives", async () => {
    const first = repo(), second = repo();
    let context = first, hold = false;
    writeFileSync(join(first.cwd, "tracked.txt"), "first repository edit\n");
    const entered = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
    const delayed: Exec = async (program, argv, options) => {
      const result = await exec(program, argv, options);
      if (hold) { hold = false; entered.resolve(); await resume.promise; }
      return result;
    };
    const controller = new ChangesController({ exec: delayed, location: () => context });
    await controller.refresh();
    controller.toggleFiles(["tracked.txt"]);
    expect(controller.files().map((file) => file.path)).toEqual(["tracked.txt"]);
    expect(controller.checked.has("tracked.txt")).toBe(true);
    context = second; hold = true;
    const refresh = controller.refresh();
    try {
      await entered.promise;
      expect(controller.files()).toEqual([]);
      expect(controller.checked.size).toBe(0);
      expect(controller.snapshot).toBeNull();
      resume.resolve(); await refresh;
      expect(controller.snapshot?.root).toBe(second.cwd);
      expect(controller.files()).toEqual([]);
    } finally {
      resume.resolve(); await refresh; controller.close();
    }
  });

  test("obsolete repository loads cannot replace a newer context or a closed view", async () => {
    const first = repo(), second = repo(); let context = first;
    const deferred = () => Promise.withResolvers<void>();
    const entered = deferred(), resume = deferred();
    let holdFirst = true;
    const delayed: Exec = async (program, argv, options) => {
      const result = await exec(program, argv, options);
      if (holdFirst) { holdFirst = false; entered.resolve(); await resume.promise; }
      return result;
    };
    const controller = new ChangesController({ exec: delayed, location: () => context });
    const obsolete = controller.refresh(); await entered.promise;
    context = second; await controller.refresh(); resume.resolve(); await obsolete;
    expect(controller.snapshot?.root).toBe(second.cwd);
    controller.close();

    const closeEntered = deferred(), closeResume = deferred();
    let holdClose = true;
    const closeExec: Exec = async (program, argv, options) => {
      const result = await exec(program, argv, options);
      if (holdClose) { holdClose = false; closeEntered.resolve(); await closeResume.promise; }
      return result;
    };
    const closed = new ChangesController({ exec: closeExec, location: () => first });
    const pending = closed.refresh(); await closeEntered.promise; closed.close(); closeResume.resolve(); await pending;
    expect(closed.snapshot).toBeNull();
  });

  test("no-folder, non-repository, clean, and select-all states use real Git", async () => {
    expect((await readSnapshot({}, exec)).state).toBe("nofolder");
    const outside = mkdtempSync(join(tmpdir(), "herdr-no-repo-")); roots.push(outside);
    expect((await readSnapshot({ cwd: outside }, exec)).state).toBe("norepo");
    const context = repo();
    expect((await readSnapshot(context, exec)).files).toHaveLength(0);
    rmSync(join(context.cwd, "tracked.txt")); writeFileSync(join(context.cwd, "new.txt"), "new\n");
    const controller = new ChangesController({ exec, location: () => context });
    await controller.refresh();
    expect(controller.checked.size).toBe(0);
    const paths = controller.files().map((file) => file.path);
    controller.toggleFiles(paths); expect(controller.checked.size).toBe(2);
    controller.toggleFiles(paths); expect(controller.checked.size).toBe(0);
    controller.toggleFiles(paths);
    controller.setDraft("Selected changes"); await controller.mutate({ type: "commit" });
    expect(controller.snapshot?.files).toHaveLength(0); controller.close();
  });
});

describe("Changes live space context", () => {
  const spaces = [
    { id: "a", active: true, folder: "/startup", machine: null, tabs: [{ id: "ta" }] },
    { id: "b", active: false, folder: "/startup", machine: "remote", tabs: [{ id: "tb" }] },
  ];
  const panes = [{ pane: "pa", tab: "ta", cwd: "/live/a" }, { pane: "pb", tab: "tb", cwd: "/live/b" }];

  test("live focus wins active snapshot lag and identical startup folders", () => {
    expect(resolveContext(spaces, panes, { space: "a", tab: "ta", pane: "pa", cwd: "/fallback/a" }))
      .toEqual({ space: "a", cwd: "/live/a", on: null });
    expect(resolveContext(spaces, panes, { space: "b", tab: "tb", pane: "pb", cwd: "/fallback/b" }))
      .toEqual({ space: "b", cwd: "/live/b", on: "remote" });
  });

  test("foreign panes cannot lend cwd to a different tab or machine", () => {
    expect(resolveContext(spaces, panes, { space: "b", tab: "tb", pane: "pa", cwd: "/fallback/b" }).cwd).toBe("/fallback/b");
    expect(resolveContext(spaces, [{ pane: "pb", tab: "ta", cwd: "/wrong" }],
      { space: "b", tab: "tb", pane: "pb", cwd: null })).toEqual({ space: "b", cwd: "/startup", on: "remote" });
    expect(resolveContext(spaces, [{ pane: "pb", tab: "unknown", cwd: "/wrong" }],
      { space: "b", tab: "unknown", pane: "pb", cwd: null }).cwd).toBe("/startup");
  });

  test("missing and mod focus fall back without borrowing stale focus", () => {
    expect(resolveContext(spaces, panes, null)).toEqual({ space: "a", cwd: "/startup", on: null });
    expect(resolveContext(spaces, panes, { space: "b", tab: "tb", pane: "mod", cwd: "" }))
      .toEqual({ space: "b", cwd: "/startup", on: "remote" });
    expect(resolveContext(spaces, panes, { space: "gone", tab: "tb", pane: "pb", cwd: "/stale" }))
      .toEqual({ space: "a", cwd: "/startup", on: null });
    expect(resolveContext([], panes, { space: "gone", tab: "tb", pane: "pb", cwd: "/stale" }))
      .toEqual({ space: null, cwd: null, on: null });
    expect(resolveContext([{ id: "empty", active: true, folder: "", machine: null, tabs: [] }], [], null).cwd).toBeNull();
  });

  test("standalone terminal machine comes from its address", () => {
    expect(resolveContext(spaces, panes, { space: "b", tab: "tb", pane: null, terminal: "other/session", cwd: "/standalone" }))
      .toEqual({ space: "b", cwd: "/standalone", on: "other" });
  });

  test("same repository across spaces reloads and cancels delayed status results", async () => {
    const base = repo();
    writeFileSync(join(base.cwd, "tracked.txt"), "old space edit\n");
    let context: Location = { ...base, space: "a" }, hold = false;
    const entered = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
    const delayed: Exec = async (program, argv, options) => {
      const result = await exec(program, argv, options);
      if (hold && argv.includes("status")) { hold = false; entered.resolve(); await resume.promise; }
      return result;
    };
    const controller = new ChangesController({ exec: delayed, location: () => context });
    await controller.refresh(); controller.setDraft("Shared repository draft");
    controller.toggleFiles(["tracked.txt"]);
    hold = true;
    const obsolete = controller.refresh();
    try {
      await entered.promise;
      context = { ...base, space: "b" };
      expect(controller.transition()).toBe(true);
      expect(controller.snapshot).toBeNull(); expect(controller.files()).toEqual([]); expect(controller.error).toBeNull();
      writeFileSync(join(base.cwd, "arriving.txt"), "new space file\n");
      await controller.refresh();
      const snapshot = controller.snapshot;
      expect(controller.files().map((file) => file.path).sort()).toEqual(["arriving.txt", "tracked.txt"]);
      expect(controller.checked.size).toBe(0);
      expect(controller.draft().message).toBe("Shared repository draft");
      resume.resolve(); await obsolete;
      expect(controller.snapshot).toBe(snapshot); expect(controller.checked.size).toBe(0); expect(controller.error).toBeNull();
    } finally { resume.resolve(); await obsolete; }
    controller.close();
  });

  test("same path on different machines isolates drafts and guards stale actions before render", async () => {
    const base = repo(); writeFileSync(join(base.cwd, "tracked.txt"), "edit\n");
    let context: Location = { ...base, space: "a", on: "machine-a" };
    const calls: { argv: string[]; on: string | null | undefined }[] = [];
    const forwarded: Exec = async (program, argv, options) => {
      calls.push({ argv, on: options.on });
      return exec(program, argv, { cwd: options.cwd, on: null });
    };
    const controller = new ChangesController({ exec: forwarded, location: () => context });
    await controller.refresh(); controller.setDraft("Machine A");
    context = { ...base, space: "b", on: "machine-b" };
    const before = calls.length;
    await controller.mutate({ type: "stash" }); controller.toggleFiles(["tracked.txt"]); controller.setDraft("Stale input");
    expect(calls).toHaveLength(before);
    await controller.refresh(); expect(controller.draft().message).toBe("");
    expect(controller.snapshot?.on).toBe("machine-b"); controller.setDraft("Machine B");
    context = { ...base, space: "a", on: "machine-a" }; await controller.refresh();
    expect(controller.draft().message).toBe("Machine A");
    expect(calls.some((call) => call.on === "machine-b")).toBe(true);
    expect(calls.some((call) => call.argv.includes("add"))).toBe(false);
    controller.close();
  });

  test("a delayed failed load cannot publish its error after a space transition", async () => {
    const base = repo(); let context: Location = { ...base, space: "a" }, hold = true;
    const entered = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
    const delayed: Exec = async (program, argv, options) => {
      if (hold) { hold = false; entered.resolve(); await resume.promise; throw new Error("Obsolete space failure"); }
      return exec(program, argv, options);
    };
    const controller = new ChangesController({ exec: delayed, location: () => context });
    const obsolete = controller.refresh();
    try {
      await entered.promise; context = { ...base, space: "b" }; await controller.refresh();
      const snapshot = controller.snapshot;
      resume.resolve(); await obsolete;
      expect(controller.snapshot).toBe(snapshot); expect(controller.error).toBeNull();
    } finally { resume.resolve(); await obsolete; controller.close(); }
  });
});

test("Changes native tree selection, constrained layout, and context scheduling stay independent of file previews", async () => {
  const first = repo(), second = repo();
  writeFileSync(join(first.cwd, "tracked.txt"), "first native edit\n");
  writeFileSync(join(second.cwd, "tracked.txt"), "second native edit\n");
  writeFileSync(join(first.cwd, "first-only.txt"), "first-only content\n");
  writeFileSync(join(second.cwd, "second-only.txt"), "second-only content\n");
  mkdirSync(join(first.cwd, "src")); writeFileSync(join(first.cwd, "src", "nested.txt"), "nested private content\n");
  const script = `
    import { mock } from "bun:test";
    import assert from "node:assert/strict";
    import { unlinkSync } from "node:fs";
    let rendering = false, lazyRendering = false, virtualHandles = 0, queries = 0, drawn = [], nodes = [], lazyRenders = [], focus, activeHandle;
    const spaces = [
      { id: "a", active: true, folder: "/same-startup", machine: null, tabs: [{ id: "ta" }] },
      { id: "b", active: false, folder: "/same-startup", machine: null, tabs: [{ id: "tb" }] },
      { id: "c", active: false, folder: "/same-startup", machine: null, tabs: [{ id: "tc" }] },
    ];
    const panes = [
      { pane: "pa", tab: "ta", cwd: ${JSON.stringify(first.cwd)} },
      { pane: "pb", tab: "tb", cwd: ${JSON.stringify(second.cwd)} },
      { pane: "pc", tab: "tc", cwd: ${JSON.stringify(first.cwd)} },
    ];
    const choose = (id) => { const pane = panes.find(p => p.pane === "p" + id); focus = { space: id, tab: pane.tab, pane: pane.pane, cwd: pane.cwd }; };
    choose("a");
    const element = (kind = "div") => {
      const data = { kind, styles: {}, children: [] };
      const node = new Proxy(data, { get: (_, key) => {
        if (key === "then") return undefined;
        if (key === "data") return data;
        if (key === "when") return (condition, apply) => { if (condition) apply(node); return node; };
        if (key === "child") return (value) => {
          data.children.push(value); if (value?.data) value.data.parent = node;
          if (typeof value === "string") drawn.push(value); return node;
        };
        if (key === "children") return (values) => { for (const value of values) node.child(value); return node; };
        return (...args) => {
          if (String(key).startsWith("on_")) assert.equal(lazyRendering, false, "handler registration inside native lazy callback: " + String(key));
          data.styles[key] = args; return node;
        };
      } });
      nodes.push(node); return node;
    };
    class Input {
      text = ""; events = new Map(); writes = [];
      static new() { return new Input(); }
      set_soft_wrap() {}
      on(name, callback) { this.events.set(name, callback); }
      value() { return this.text; }
      set_value(value) {
        assert.equal(rendering, false, "native Textarea.set_value during render");
        this.writes.push(value); this.text = value; this.events.get("change")?.({}, cx);
      }
      release() { assert.equal(rendering, false); }
    }
    mock.module("gpui-kit", () => ({ View: class {}, div: () => element(), svg: () => element("svg"), image: () => element("image") }));
    mock.module("gpui-base", () => ({
      h_flex: () => element("h_flex"), v_flex: () => element("v_flex"),
      Checkbox: { new: (id) => element("checkbox").id(id) }, TextareaState: Input, Textarea: { new: () => element("textarea") },
      VirtualListScrollHandle: { new: () => { virtualHandles++; return { release() {}, scroll_to_item() {} }; } },
      Scrollbar: { vertical: () => element("vertical-scrollbar"), horizontal: (id) => element("horizontal-scrollbar").scroll_target(id) },
      v_virtual_list: (id, count, height, _key, draw) => {
        const list = element("virtual-list").id(id).row_height(height);
        lazyRenders.push(() => {
          lazyRendering = true;
          try { list.children(draw({ start: 0, end: count })); } finally { lazyRendering = false; }
        });
        return list;
      },
    }));
    mock.module("herdr", () => ({
      spaces: () => spaces, panes: () => panes, focused: () => focus,
      settings: () => ({ zoom: 1 }),
      theme: () => ({
        background: "#112233", foreground: "#112233", accent: "#112233",
        solid: "#112233", solid_foreground: "#112233", hover: "#112233",
        input: "#112233", muted: "#112233", raised: "#112233", border: "#112233",
        ansi1: "#112233", ansi2: "#112233",
      }), setShared() {},
      exec: async (program, argv, options) => {
        assert.equal(rendering, false, "Git queried during render"); queries++;
        assert(!argv.includes("diff") && !argv.includes("show") && !argv.includes("cat-file") && !argv.includes("ls-files"),
          "listing and inclusion must not load file content");
        const result = Bun.spawnSync([program, ...argv], { cwd: options.cwd, env: ${JSON.stringify(env)} });
        return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
      },
    }));
    const once = [], repeat = [], pending = [];
    const register = (list, callback) => {
      const timer = { callback, cancelled: false, cancel() { this.cancelled = true; } };
      list.push(timer); return timer;
    };
    const cx = {
      focus_handle: () => {
        const handle = { is_focused: () => activeHandle === handle, focus() { activeHandle = handle; } };
        return handle;
      },
      notify() { assert.equal(rendering, false, "native notify during render"); },
      spawn(callback) { assert.equal(rendering, false, "spawn starts action during render"); pending.push(callback()); },
      timer: { after: (_ms, callback) => register(once, callback), every: (_ms, callback) => register(repeat, callback) },
    };
    const settle = async () => { while (pending.length) await Promise.all(pending.splice(0)); };
    const flush = async () => { for (const timer of once.splice(0)) if (!timer.cancelled) timer.callback(cx); await settle(); };
    const tick = async () => { for (const timer of repeat) if (!timer.cancelled) timer.callback(cx); await flush(); };
    const layoutLazyLists = () => { for (const draw of lazyRenders.splice(0)) draw(); };
    // Static imports would resolve unavailable platform modules before these native mocks register.
    const { v_virtual_list } = await import("gpui-base");
    for (const handler of ["on_click", "on_mouse_down", "on_change", "on_key_down", "on_hover", "on_scroll_wheel", "on_size_change"]) {
      v_virtual_list("guard-" + handler, 1, 24, () => "row", () => [element()[handler](() => {})]);
      assert.throws(layoutLazyLists, /handler registration inside native lazy callback/, handler + " must respect native layout restrictions");
    }
    // Register mocks before dynamically importing this platform-only module.
    // Assertions inspect render structure, not native GPUI pixels.
    const { default: Changes } = await import(${JSON.stringify(new URL("../herdr/mods/t3-changes/main.js", import.meta.url).href)});
    const view = new Changes(); view.init({}, cx); await settle();
    const render = () => {
      drawn = []; nodes = []; lazyRenders = []; rendering = true;
      try { const root = view.render(cx); layoutLazyLists(); return root; } finally { rendering = false; }
    };
    const byId = (suffix) => {
      const node = nodes.find(node => node.data.styles.id?.[0] === view.id + suffix);
      assert(node, "missing rendered control " + suffix); return node;
    };
    const emit = (node, name, event = {}) => {
      let stopped = false;
      const handler = node.data.styles[name]?.[0];
      assert.equal(typeof handler, "function", "missing handler " + name);
      handler(event, { ...cx, stop_propagation() { stopped = true; } });
      return stopped;
    };
    const key = (value) => {
      const tree = nodes.find(node => node.data.styles.accessibility_label?.[0]?.startsWith("Changed files."));
      return emit(tree, "on_key_down", { key: value });
    };
    const onlySelected = (suffix) => {
      const rows = nodes.filter(node => node.data.styles.id?.[0]?.startsWith(view.id + "-row-"));
      assert.deepEqual(rows.filter(node => node.data.styles.bg?.[0] === "#1122331f").map(node => node.data.styles.id[0]), [view.id + suffix]);
    };
    assert.equal(view.controller.snapshot.space, "a");
    view.controller.setDraft("Draft from A");
    for (const [width, height] of [[320, 300], [640, 480], [1440, 600]]) {
      const before = queries, root = render();
      emit(root, "on_size_change", { width, height });
      const sized = render(), [column, footer] = sized.data.children;
      assert.equal(column.data.kind, "v_flex"); assert.deepEqual(column.data.styles.w_full, []);
      assert.deepEqual(column.data.styles.flex_1, []); assert.deepEqual(column.data.styles.min_h, [0]);
      assert.equal(column.data.styles.h_full, undefined, "list must not claim the footer's height");
      assert.equal(column.data.styles.w, undefined, "list must never use the former 48% split");
      assert.equal(footer.data.kind, "v_flex"); assert.deepEqual(footer.data.styles.flex_none, []);
      const tree = column.data.children.at(-1), viewport = tree.data.children[1];
      assert.deepEqual(tree.data.styles.flex_1, []); assert.deepEqual(tree.data.styles.min_h, [0]);
      assert.deepEqual(viewport.data.styles.flex_1, []); assert.deepEqual(viewport.data.styles.min_h, [24]);
      assert.deepEqual(byId("-tree-x").data.styles.absolute, []);
      assert.deepEqual(byId("-tree-x").data.styles.inset_0, []);
      const available = height - footer.data.styles.h[0] - column.data.children[0].data.styles.h[0]
        - tree.data.children[0].data.styles.h[0] - tree.data.children[2].data.styles.h[0];
      assert(available >= 24, "normal sidebar height must reserve at least one complete file row");
      emit(byId("-tree-y"), "on_size_change", { width, height: available });
      render();
      const visible = byId("-tree-y");
      assert.deepEqual(visible.data.styles.overflow_hidden, []);
      assert.deepEqual(visible.data.styles.size_full, []);
      assert(visible.data.children.length > 0 && visible.data.children.length <= Math.ceil(available / 24) + 1);
      assert(visible.data.children.every(row => typeof row.data.styles.on_click?.[0] === "function"),
        "visible rows must register handlers during ordinary render");
      if (available >= 96) assert(drawn.includes("tracked.txt") && drawn.includes("first-only.txt") && drawn.includes("nested.txt"));
      assert(nodes.some(node => node.data.kind === "textarea"));
      assert.equal(nodes.filter(node => node.data.kind === "virtual-list").length, 0);
      assert.equal(virtualHandles, 0, "ordinary-render lists must not allocate native lazy-list handles");
      assert.equal(nodes.filter(node => node.data.kind === "vertical-scrollbar").length, 0);
      assert.equal(nodes.filter(node => node.data.kind === "horizontal-scrollbar").length, 1);
      assert.equal(nodes.find(node => node.data.kind === "horizontal-scrollbar").data.styles.scroll_target[0], view.id + "-tree-x");
      assert(!nodes.some(node => String(node.data.styles.id?.[0]).includes("-diff")));
      assert(!nodes.some(node => /preview/i.test(node.data.styles.accessibility_label?.[0] ?? "")));
      for (const content of ["first native edit", "first-only content", "nested private content"]) assert(!drawn.includes(content));
      assert.equal(queries, before, "resizing and rendering must not read Git");
    }
    assert.equal(view.controller.checked.size, 0);
    assert(drawn.includes("3 files · 0 selected"));
    assert.equal(byId("-commit").data.styles.disabled[0], true, "a draft alone must not enable a normal commit");
    const beforeSelection = queries;
    emit(byId("-row-file-tracked.txt"), "on_click"); render();
    assert.equal(view.controller.checked.has("tracked.txt"), true);
    assert.equal(byId("-check-tracked.txt").data.styles.checked[0], true);
    onlySelected("-row-file-tracked.txt");
    assert.equal(byId("-commit").data.styles.disabled[0], false, "explicit file inclusion must enable a valid commit");
    key("enter"); render(); assert.equal(view.controller.checked.has("tracked.txt"), false);
    key("space"); render(); assert.equal(view.controller.checked.has("tracked.txt"), true);
    key("space"); render(); assert.equal(view.controller.checked.has("tracked.txt"), false);
    const box = byId("-check-tracked.txt");
    let stopped = false;
    box.data.styles.on_mouse_down[1]({}, { ...cx, stop_propagation() { stopped = true; } });
    assert(stopped, "checkbox mouse down must not focus or activate its row");
    emit(box, "on_change", true);
    if (!emit(box, "on_click")) emit(byId("-row-file-tracked.txt"), "on_click");
    render(); assert.equal(view.controller.checked.has("tracked.txt"), true, "checkbox click must toggle exactly once");
    assert.equal(byId("-check-tracked.txt").data.styles.checked[0], true);
    const focusedRow = byId("-row-file-tracked.txt");
    assert.equal(focusedRow.data.styles.border_color[0], "#112233", "keyboard focus must retain a ring");
    assert.equal(focusedRow.data.styles.bg[0], "#1122331f", "direct interaction must highlight the acted-on row");
    emit(byId("-row-folder-src"), "on_click"); render(); assert(!drawn.includes("nested.txt"));
    key("enter"); render(); assert(drawn.includes("nested.txt"));
    emit(byId("-folder-src"), "on_change", true); render();
    assert(view.controller.checked.has("src/nested.txt"));
    assert.equal(byId("-check-src/nested.txt").data.styles.checked[0], true);
    assert.equal(byId("-check-tracked.txt").data.styles.checked[0], true);
    onlySelected("-row-folder-src");
    emit(byId("-check-src/nested.txt"), "on_change", false); render();
    assert(!view.controller.checked.has("src/nested.txt"));
    assert.equal(byId("-folder-src").data.styles.checked[0], false);
    onlySelected("-row-file-src/nested.txt");
    emit(byId("-folder-src"), "on_change", true); render();
    assert(view.controller.checked.has("src/nested.txt")); onlySelected("-row-folder-src");
    emit(byId("-folder-src"), "on_change", false); render(); assert(!view.controller.checked.has("src/nested.txt"));
    onlySelected("-row-folder-src");
    key("down"); render(); onlySelected("-row-folder-src");
    key("space"); render(); onlySelected("-row-file-src/nested.txt");
    assert(view.controller.checked.has("src/nested.txt"));
    key("enter"); render(); assert(!view.controller.checked.has("src/nested.txt"));
    onlySelected("-row-file-src/nested.txt");
    emit(byId("-all"), "on_change", true); render(); assert.equal(view.controller.checked.size, 3);
    emit(byId("-all"), "on_change", false); render(); assert.equal(view.controller.checked.size, 0);
    emit(byId("-all"), "on_change", true); render(); assert.equal(view.controller.checked.size, 3);
    view.controller.busy = true; emit(byId("-row-file-tracked.txt"), "on_click");
    assert(view.controller.checked.has("tracked.txt")); view.controller.busy = false;
    assert.equal(queries, beforeSelection, "all inclusion interactions must remain content-free");
    const many = Array.from({ length: 180 }, (_, i) => "many-" + String(i).padStart(3, "0") + ".txt");
    for (const path of many) await Bun.write(${JSON.stringify(first.cwd)} + "/" + path, "unselected fixture content\\n");
    await view.controller.refresh(); render();
    assert.deepEqual([...view.controller.checked].sort(), ["first-only.txt", "src/nested.txt", "tracked.txt"],
      "refresh must preserve explicit selections without including newly discovered files");
    emit(byId("-tree-y"), "on_size_change", { width: 640, height: 96 }); render();
    assert.equal(byId("-tree-y").data.children.length, 4, "only the measured visible window should build interactive rows");
    assert(!drawn.includes("many-179.txt") && !drawn.includes("tracked.txt"));
    view.handles.tree.focus(); key("end"); render();
    assert(drawn.includes("tracked.txt"), "End must reveal the offscreen final file");
    assert.equal(view.scrollTop[view.id + "-tree-y"], (view.rows().length - 4) * 24);
    const beforeWheel = queries, highlighted = view.treeAt, endTop = view.scrollTop[view.id + "-tree-y"];
    assert(emit(byId("-tree-y"), "on_scroll_wheel", { delta: { x: 0, y: 48 } }));
    render(); assert.equal(view.scrollTop[view.id + "-tree-y"], endTop - 48);
    assert.equal(view.treeAt, highlighted, "wheel movement must not move keyboard selection");
    render(); assert.equal(view.scrollTop[view.id + "-tree-y"], endTop - 48, "selection must not snap the wheel back");
    key("home"); render(); assert.equal(view.scrollTop[view.id + "-tree-y"], 0);
    assert(drawn.includes("first-only.txt") && !drawn.includes("tracked.txt"), "Home must reveal the first row");
    const wheel = byId("-tree-y");
    emit(wheel, "on_scroll_wheel", { delta: { x: 0, y: -48 } });
    emit(wheel, "on_scroll_wheel", { delta: { x: 0, y: -48 } });
    render(); assert.equal(view.scrollTop[view.id + "-tree-y"], 96, "trackpad events must accumulate before rendering");
    assert(drawn.includes("many-003.txt") && !drawn.includes("first-only.txt"));
    const visibleBox = nodes.find(node => node.data.kind === "checkbox" && node.data.styles.id[0].includes("-check-many-"));
    const visiblePath = visibleBox.data.styles.id[0].split("-check-")[1];
    const included = view.controller.checked.has(visiblePath);
    emit(visibleBox, "on_change", !included); render();
    assert.equal(view.controller.checked.has(visiblePath), !included, "wheeled rows must retain working native checkboxes");
    onlySelected("-row-file-" + visiblePath);
    assert.equal(view.scrollTop[view.id + "-tree-y"], 96, "inclusion changes must preserve the wheel position");
    assert.equal(queries, beforeWheel, "wheel and keyboard navigation must remain content-free");
    for (const path of many) unlinkSync(${JSON.stringify(first.cwd)} + "/" + path);
    await view.controller.refresh(); render();
    assert.equal(view.activeRow, null, "removing the active row must clear its highlight");
    emit(byId("-tree-y"), "on_size_change", { width: 1440, height: 240 }); render();
    const initialQueries = queries;
    for (let i = 0; i < 12; i++) { render(); await tick(); }
    emit(byId("-row-file-tracked.txt"), "on_click"); render(); onlySelected("-row-file-tracked.txt");
    assert.equal(queries, initialQueries, "stable focus must not poll Git");
    view.controller.error = "Old context error"; choose("b");
    const beforeSwitch = queries, beforeWrites = view.messageState.writes.length;
    render();
    assert.equal(queries, beforeSwitch); assert.equal(view.messageState.writes.length, beforeWrites);
    assert.equal(view.controller.snapshot, null); assert.equal(view.controller.checked.size, 0);
    assert.equal(view.activeRow, null, "context transitions must clear the active row");
    assert(!drawn.includes("first-only.txt") && !drawn.includes("Old context error"));
    await flush(); render();
    assert.equal(view.controller.snapshot.space, "b"); assert.equal(view.messageState.value(), "");
    assert(drawn.includes("second-only.txt") && drawn.includes("tracked.txt")); assert(!drawn.includes("second native edit"));
    assert.notEqual(byId("-row-file-tracked.txt").data.styles.bg?.[0], "#1122331f", "matching paths in another context must not inherit a highlight");
    choose("c"); render(); await flush();
    assert.equal(view.controller.snapshot.space, "c");
    assert.equal(view.messageState.value(), "Draft from A", "draft scope remains machine/repository");
    choose("a"); const beforeSameRepo = queries; render(); await flush();
    assert.equal(view.controller.snapshot.space, "a"); assert(queries > beforeSameRepo, "another space must reload");
    const stableQueries = queries;
    for (let i = 0; i < 12; i++) { render(); await tick(); }
    assert.equal(queries, stableQueries);
    render(); emit(byId("-refresh"), "on_click"); await settle();
    assert(queries > stableQueries, "manual Refresh must read Git");
    render(); assert.equal(view.controller.checked.size, 0, "returning to a context must require fresh explicit selections");
    emit(byId("-row-file-tracked.txt"), "on_click"); render();
    assert.deepEqual([...view.controller.checked], ["tracked.txt"]);
    view.messageState.text = "Native selected commit";
    view.messageState.events.get("change")({}, cx); render();
    emit(byId("-commit"), "on_click"); await settle(); render();
    assert.equal(view.controller.error, null);
    assert(drawn.includes("first-only.txt") && drawn.includes("nested.txt") && !drawn.includes("tracked.txt"));
    assert.equal(view.messageState.value(), "");
    choose("b"); render();
    const beforeClose = queries; view.close(); await flush(); await tick();
    assert.equal(queries, beforeClose, "closed view must cancel pending context work");
    assert(repeat.every(timer => timer.cancelled));
    console.log("Changes native tree and scheduling passed");
  `;
  const child = Bun.spawn([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
  expect(stdout).toContain("Changes native tree and scheduling passed");
  expect(must(first.cwd, "show", "HEAD:tracked.txt")).toBe("first native edit\n");
  expect(git(first.cwd, "show", "HEAD:first-only.txt").code).not.toBe(0);
  expect(readFileSync(join(first.cwd, "first-only.txt"), "utf8")).toBe("first-only content\n");
  expect(readFileSync(join(first.cwd, "src", "nested.txt"), "utf8")).toBe("nested private content\n");
}, 30_000);
