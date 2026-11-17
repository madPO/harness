import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, symlinkSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseStatus, groupsOf, fileTree, treeRows, parseDiff, commitArgs, displayPath, parsePrevious, unifiedFiles } from "../herdr/mods/t3-changes/model.js";
import { readSnapshot, readDiff, perform, type Exec } from "../herdr/mods/t3-changes/git.js";
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
  test("unified diffs preserve both gutters and no-final-newline notes", () => {
    const rows = parseDiff("diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -7,2 +7,2 @@\n same\n-old\n+new\n\\ No newline at end of file\n");
    expect(rows).toEqual([{ kind: "hunk", text: "@@ -7,2 +7,2 @@" }, { kind: " ", text: "same", old: 7, next: 7 },
      { kind: "-", text: "old", old: 8 }, { kind: "+", text: "new", next: 8 }, { kind: "note", text: "No newline at end of file" }]);
    expect(parseDiff("Binary files a/a and b/a differ\n")[0].text).toContain("Binary");
    expect(parseDiff("old mode 100644\nnew mode 100755\n").at(-1)?.text).toContain("mode changed");
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
    expect((await readDiff(snapshot, snapshot.groups.staged[0], exec)).some((r) => r.kind === "+" && r.text === "index")).toBe(true);
    const untracked = snapshot.groups.unstaged.find((file) => file.path === path);
    if (!untracked) throw new Error("Expected literal untracked path");
    expect((await readDiff(snapshot, untracked, exec)).some((r) => r.text === "literal")).toBe(true);
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

  test("untracked symlinks never expose outside contents; empty, binary, and mode diffs are honest", async () => {
    const context = repo(), outside = mkdtempSync(join(tmpdir(), "herdr-outside-")); roots.push(outside);
    writeFileSync(join(outside, "secret"), "MUST_NOT_APPEAR_IN_PREVIEW\n");
    symlinkSync(join(outside, "secret"), join(context.cwd, "link"));
    writeFileSync(join(context.cwd, "empty"), ""); writeFileSync(join(context.cwd, "binary"), Buffer.from([0, 1, 2]));
    chmodSync(join(context.cwd, "tracked.txt"), 0o755);
    const snapshot = await readSnapshot(context, exec);
    for (const file of snapshot.groups.unstaged) {
      const rows = await readDiff(snapshot, file, exec), text = rows.map((r) => r.text).join("\n");
      expect(text).not.toContain("MUST_NOT_APPEAR_IN_PREVIEW");
      if (file.path === "link") expect(text).toContain("Symbolic link");
      if (file.path === "binary") expect(text).toContain("Binary");
      if (file.path === "empty") expect(text).toMatch(/empty|mode/);
      if (file.path === "tracked.txt") expect(text).toContain("mode changed");
    }
  });

  test("controller refreshes unchanged XY diffs and isolates drafts", async () => {
    const first = repo(), second = repo(); let context = first;
    writeFileSync(join(first.cwd, "tracked.txt"), "first edit\n");
    const controller = new ChangesController({ exec, location: () => context });
    const message = "Keep my draft\n\nWith its detail";
    await controller.refresh(); controller.setDraft(message);
    writeFileSync(join(first.cwd, "tracked.txt"), "second edit\n");
    await controller.refresh(); expect(controller.diff?.some((r) => r.text === "second edit")).toBe(true);
    context = second; await controller.refresh(); expect(controller.draft().message).toBe("");
    context = first; await controller.refresh(); expect(controller.draft().message).toBe(message);
    controller.toggleFiles(["tracked.txt"]);
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
      await controller.refresh(); controller.setDraft(message);
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

  test("same-file refresh keeps the displayed diff during status and diff reads", async () => {
    const context = repo();
    writeFileSync(join(context.cwd, "tracked.txt"), "displayed edit\n");
    const statusEntered = Promise.withResolvers<void>(), statusResume = Promise.withResolvers<void>();
    const diffEntered = Promise.withResolvers<void>(), diffResume = Promise.withResolvers<void>();
    let hold = false, report = () => {};
    const delayed: Exec = async (program, argv, options) => {
      const result = await exec(program, argv, options);
      if (hold && argv.includes("status")) { statusEntered.resolve(); await statusResume.promise; }
      if (hold && argv.includes("diff")) { hold = false; diffEntered.resolve(); await diffResume.promise; }
      return result;
    };
    const controller = new ChangesController({ exec: delayed, location: () => context, changed: () => report() });
    await controller.refresh();
    const displayed = controller.diff, preserved: boolean[] = [];
    expect(displayed?.some((row) => row.text === "displayed edit")).toBe(true);
    report = () => preserved.push(controller.diff === displayed);
    writeFileSync(join(context.cwd, "tracked.txt"), "replacement edit\n");
    hold = true;
    const refresh = controller.refresh();
    try {
      await statusEntered.promise;
      expect(controller.loading).toBe(true);
      expect(controller.diff).toBe(displayed);
      statusResume.resolve();
      await diffEntered.promise;
      expect(controller.loading).toBe(true);
      expect(controller.diff).toBe(displayed);
      expect(preserved.length).toBeGreaterThan(0);
      expect(preserved.every(Boolean)).toBe(true);
      diffResume.resolve();
      await refresh;
      expect(controller.loading).toBe(false);
      expect(controller.diff).not.toBe(displayed);
      expect(controller.diff?.some((row) => row.text === "replacement edit")).toBe(true);
      expect(controller.diff?.some((row) => row.text === "displayed edit")).toBe(false);
    } finally {
      statusResume.resolve(); diffResume.resolve(); await refresh; controller.close();
    }
  });

  test("switching diff groups clears old rows and rejects a pending refresh result", async () => {
    const context = repo();
    writeFileSync(join(context.cwd, "tracked.txt"), "staged edit\n"); must(context.cwd, "add", "tracked.txt");
    writeFileSync(join(context.cwd, "tracked.txt"), "unstaged edit\n");
    const entered = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
    let hold = false;
    const delayed: Exec = async (program, argv, options) => {
      const result = await exec(program, argv, options);
      if (hold && argv.includes("diff") && !argv.includes("--cached")) {
        hold = false; entered.resolve(); await resume.promise;
      }
      return result;
    };
    const controller = new ChangesController({ exec: delayed, location: () => context });
    await controller.refresh();
    expect(controller.selected?.group).toBe("unstaged");
    hold = true;
    const refresh = controller.refresh();
    try {
      await entered.promise;
      const staged = controller.snapshot?.groups.staged[0];
      if (!staged) throw new Error("Expected staged version of selected file");
      const selection = controller.select(staged);
      expect(controller.diff).toBeNull();
      await selection;
      expect(controller.selected?.group).toBe("staged");
      expect(controller.diff?.some((row) => row.kind === "+" && row.text === "staged edit")).toBe(true);
      const displayed = controller.diff;
      resume.resolve(); await refresh;
      expect(controller.diff).toBe(displayed);
      expect(controller.loading).toBe(false);
    } finally {
      resume.resolve(); await refresh; controller.close();
    }
  });

  test("changing repository context clears the displayed diff before the new snapshot arrives", async () => {
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
    expect(controller.diff?.some((row) => row.text === "first repository edit")).toBe(true);
    context = second; hold = true;
    const refresh = controller.refresh();
    try {
      await entered.promise;
      expect(controller.diff).toBeNull();
      expect(controller.selected).toBeNull();
      expect(controller.snapshot).toBeNull();
      resume.resolve(); await refresh;
      expect(controller.snapshot?.root).toBe(second.cwd);
      expect(controller.diff).toBeNull();
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
    expect(controller.checked.size).toBe(2);
    const paths = controller.files().map((file) => file.path);
    controller.toggleFiles(paths); expect(controller.checked.size).toBe(0);
    controller.toggleFiles(paths); expect(controller.checked.size).toBe(2);
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

  test("same repository across spaces reloads and cancels delayed status and diff results", async () => {
    const base = repo();
    writeFileSync(join(base.cwd, "tracked.txt"), "old space edit\n");
    let context: Location = { ...base, space: "a" }, hold: "status" | "diff" | null = null;
    let entered = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
    const delayed: Exec = async (program, argv, options) => {
      const result = await exec(program, argv, options);
      if (hold && argv.includes(hold)) { hold = null; entered.resolve(); await resume.promise; }
      return result;
    };
    const controller = new ChangesController({ exec: delayed, location: () => context });
    await controller.refresh(); controller.setDraft("Shared repository draft");
    for (const phase of ["status", "diff"] as const) {
      context = { ...base, space: "a" }; await controller.refresh();
      hold = phase; entered = Promise.withResolvers<void>(); resume = Promise.withResolvers<void>();
      const obsolete = controller.refresh();
      try {
        await entered.promise;
        context = { ...base, space: "b" };
        expect(controller.transition()).toBe(true);
        expect(controller.snapshot).toBeNull(); expect(controller.diff).toBeNull(); expect(controller.error).toBeNull();
        writeFileSync(join(base.cwd, "tracked.txt"), `new ${phase} edit\n`);
        await controller.refresh();
        const displayed = controller.diff, snapshot = controller.snapshot;
        expect(displayed?.some((row) => row.text === `new ${phase} edit`)).toBe(true);
        expect(controller.draft().message).toBe("Shared repository draft");
        resume.resolve(); await obsolete;
        expect(controller.snapshot).toBe(snapshot); expect(controller.diff).toBe(displayed); expect(controller.error).toBeNull();
      } finally { resume.resolve(); await obsolete; }
    }
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
    const old = controller.selected;
    context = { ...base, space: "b", on: "machine-b" };
    const before = calls.length;
    await controller.select(old); await controller.mutate({ type: "stash" }); controller.toggleFiles(["tracked.txt"]); controller.setDraft("Stale input");
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

test("Changes native scheduling defers input writes, avoids stable Git polling, and cancels close work", async () => {
  const first = repo(), second = repo();
  writeFileSync(join(first.cwd, "tracked.txt"), "first native edit\n");
  writeFileSync(join(second.cwd, "tracked.txt"), "second native edit\n");
  writeFileSync(join(first.cwd, "first-only.txt"), "first-only content\n");
  writeFileSync(join(second.cwd, "second-only.txt"), "second-only content\n");
  const script = `
    import { mock } from "bun:test";
    import assert from "node:assert/strict";
    let rendering = false, queries = 0, drawn = [], focus;
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
    const element = () => {
      const node = new Proxy({}, { get: (_, key) => {
        if (key === "then") return undefined;
        if (key === "when") return (condition, apply) => { if (condition) apply(node); return node; };
        if (key === "child") return (value) => { if (typeof value === "string") drawn.push(value); return node; };
        return () => node;
      } });
      return node;
    };
    class Input {
      text = ""; events = new Map(); writes = [];
      static new() { return new Input(); }
      set_auto_grow() {} set_soft_wrap() {}
      on(name, callback) { this.events.set(name, callback); }
      value() { return this.text; }
      set_value(value) {
        assert.equal(rendering, false, "native Textarea.set_value during render");
        this.writes.push(value); this.text = value; this.events.get("change")?.({}, cx);
      }
      release() { assert.equal(rendering, false); }
    }
    mock.module("gpui-kit", () => ({ View: class {}, div: element, svg: element, image: element }));
    mock.module("gpui-base", () => ({
      h_flex: element, v_flex: element, Checkbox: { new: element }, TextareaState: Input, Textarea: { new: element },
      VirtualListScrollHandle: { new: () => ({ release() {}, scroll_to_item() {} }) },
      Scrollbar: { vertical: element, horizontal: element },
      v_virtual_list: (_id, count, _height, _key, render) => { render({ start: 0, end: count }); return element(); },
    }));
    mock.module("herdr", () => ({
      spaces: () => spaces, panes: () => panes, focused: () => focus,
      settings: () => ({ zoom: 1 }),
      theme: () => new Proxy({}, { get: () => "#112233" }), setShared() {},
      exec: async (program, argv, options) => {
        assert.equal(rendering, false, "Git queried during render"); queries++;
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
      focus_handle: () => ({ is_focused: () => false, focus() {} }),
      notify() { assert.equal(rendering, false, "native notify during render"); },
      spawn(callback) { assert.equal(rendering, false, "spawn starts action during render"); pending.push(callback()); },
      timer: { after: (_ms, callback) => register(once, callback), every: (_ms, callback) => register(repeat, callback) },
    };
    const settle = async () => { while (pending.length) await Promise.all(pending.splice(0)); };
    const flush = async () => { for (const timer of once.splice(0)) if (!timer.cancelled) timer.callback(cx); await settle(); };
    const tick = async () => { for (const timer of repeat) if (!timer.cancelled) timer.callback(cx); await flush(); };
    // Native mocks must register before dynamically importing this platform-only module.
    const { default: Changes } = await import(${JSON.stringify(new URL("../herdr/mods/t3-changes/main.js", import.meta.url).href)});
    const view = new Changes(); view.init({}, cx); await settle();
    const render = () => { drawn = []; rendering = true; try { view.render(cx); } finally { rendering = false; } };
    assert.equal(view.controller.snapshot.space, "a");
    view.controller.setDraft("Draft from A");
    const initialQueries = queries;
    for (let i = 0; i < 12; i++) { render(); await tick(); }
    assert.equal(queries, initialQueries, "stable focus must not poll Git");
    view.controller.error = "Old context error";
    choose("b");
    const beforeSwitch = queries, beforeWrites = view.messageState.writes.length;
    render();
    assert.equal(queries, beforeSwitch); assert.equal(view.messageState.writes.length, beforeWrites);
    assert.equal(view.controller.snapshot, null); assert.equal(view.controller.diff, null);
    assert.equal(drawn.includes("first native edit"), false);
    assert.equal(drawn.includes("first-only.txt"), false);
    assert.equal(drawn.includes("Old context error"), false);
    await flush();
    assert.equal(view.controller.snapshot.space, "b");
    assert.equal(view.messageState.value(), "");
    assert(view.controller.diff.some(row => row.text === "second native edit"));
    choose("c"); render(); await flush();
    assert.equal(view.controller.snapshot.space, "c");
    assert.equal(view.messageState.value(), "Draft from A", "draft scope remains machine/repository");
    choose("a"); const beforeSameRepo = queries; render(); await flush();
    assert.equal(view.controller.snapshot.space, "a");
    assert(queries > beforeSameRepo, "same cwd with another space must reload");
    const stableQueries = queries;
    for (let i = 0; i < 12; i++) { render(); await tick(); }
    assert.equal(queries, stableQueries);
    await view.controller.refresh(); assert(queries > stableQueries, "manual Refresh must read Git");
    const paths = view.controller.files().map(file => file.path);
    view.controller.toggleFiles(paths); assert.equal(view.controller.checked.size, 0);
    view.controller.toggleFiles(paths); assert.equal(view.controller.checked.size, 2);
    choose("b"); render();
    const beforeClose = queries; view.close(); await flush(); await tick();
    assert.equal(queries, beforeClose, "closed view must cancel pending context work");
    assert(repeat.every(timer => timer.cancelled));
    console.log("Changes native context scheduling passed");
  `;
  // Bun module mocks stay inside this child process and cannot contaminate other suites.
  const child = Bun.spawn([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
  expect(stdout).toContain("Changes native context scheduling passed");
}, 30_000);
