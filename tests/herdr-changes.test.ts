import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, symlinkSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseStatus, groupsOf, fileTree, treeRows, parseDiff, commitArgs, displayPath } from "../herdr/mods/t3-changes/model.js";
import { readSnapshot, readDiff, perform, type Exec } from "../herdr/mods/t3-changes/git.js";
import { ChangesController } from "../herdr/mods/t3-changes/controller.js";

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
  test("unified diffs preserve both gutters and no-final-newline notes", () => {
    const rows = parseDiff("diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -7,2 +7,2 @@\n same\n-old\n+new\n\\ No newline at end of file\n");
    expect(rows).toEqual([{ kind: "hunk", text: "@@ -7,2 +7,2 @@" }, { kind: " ", text: "same", old: 7, next: 7 },
      { kind: "-", text: "old", old: 8 }, { kind: "+", text: "new", next: 8 }, { kind: "note", text: "No newline at end of file" }]);
    expect(parseDiff("Binary files a/a and b/a differ\n")[0].text).toContain("Binary");
    expect(parseDiff("old mode 100644\nnew mode 100755\n").at(-1)?.text).toContain("mode changed");
    expect(() => commitArgs("  ")).toThrow(); expect(() => commitArgs("bad\nsubject")).toThrow();
  });
});

describe("Changes real Git boundary", () => {
  test("loads both groups and stages literal special filenames only", async () => {
    const context = repo(), root = context.cwd, path = "-odd [x]*\nname.txt";
    writeFileSync(join(root, "tracked.txt"), "index\n"); must(root, "add", "tracked.txt");
    writeFileSync(join(root, "tracked.txt"), "worktree\n");
    writeFileSync(join(root, path), "literal\n"); writeFileSync(join(root, "unrelated.txt"), "leave untracked\n");
    let snapshot = await readSnapshot(context, exec);
    expect(snapshot.groups.staged[0].path).toBe("tracked.txt");
    expect(snapshot.groups.unstaged.find((f) => f.path === "tracked.txt")).toBeDefined();
    expect((await readDiff(snapshot, snapshot.groups.staged[0], exec)).some((r) => r.kind === "+" && r.text === "index")).toBe(true);
    const untracked = snapshot.groups.unstaged.find((file) => file.path === path);
    if (!untracked) throw new Error("Expected literal untracked path");
    expect((await readDiff(snapshot, untracked, exec)).some((r) => r.text === "literal")).toBe(true);
    expect((await perform(snapshot, { type: "stage", path }, exec)).ok).toBe(true);
    snapshot = await readSnapshot(context, exec);
    expect(snapshot.groups.staged.some((f) => f.path === path)).toBe(true);
    expect(snapshot.groups.unstaged.some((f) => f.path === "unrelated.txt")).toBe(true);
    expect((await perform(snapshot, { type: "unstage", path }, exec)).ok).toBe(true);
    expect(readFileSync(join(root, path), "utf8")).toBe("literal\n");
  });

  test("unstages an unborn index without losing newer worktree content", async () => {
    const context = repo(false), root = context.cwd;
    writeFileSync(join(root, "new.txt"), "index\n"); must(root, "add", "new.txt");
    writeFileSync(join(root, "new.txt"), "newer work\n");
    const snapshot = await readSnapshot(context, exec);
    expect(snapshot.head).toBeNull(); expect(snapshot.groups.staged).toHaveLength(1);
    expect((await perform(snapshot, { type: "unstage" }, exec)).ok).toBe(true);
    expect((await readSnapshot(context, exec)).groups.staged).toHaveLength(0);
    expect(readFileSync(join(root, "new.txt"), "utf8")).toBe("newer work\n");
  });

  test("commit preserves description and leaves unstaged content outside HEAD", async () => {
    const context = repo(), root = context.cwd;
    writeFileSync(join(root, "tracked.txt"), "staged only\n"); must(root, "add", "tracked.txt");
    writeFileSync(join(root, "tracked.txt"), "not committed\n");
    const snapshot = await readSnapshot(context, exec);
    expect((await perform(snapshot, { type: "commit", subject: "Subject", description: "First detail\nSecond detail" }, exec)).ok).toBe(true);
    expect(must(root, "show", "HEAD:tracked.txt")).toBe("staged only\n");
    expect(must(root, "log", "-1", "--format=%B").trimEnd()).toBe("Subject\n\nFirst detail\nSecond detail");
    expect((await readSnapshot(context, exec)).groups.unstaged).toHaveLength(1);
  });

  test("preflight rejects branch changes and focus changes before Git writes", async () => {
    const context = repo(), root = context.cwd;
    writeFileSync(join(root, "tracked.txt"), "changed\n");
    const snapshot = await readSnapshot(context, exec);
    must(root, "switch", "-c", "other");
    expect((await perform(snapshot, { type: "stage" }, exec)).message).toContain("HEAD or branch changed");
    expect((await readSnapshot(context, exec)).groups.staged).toHaveLength(0);
    const fresh = await readSnapshot(context, exec);
    let focused = true;
    const switchedExec: Exec = async (program, args, options) => { const result = await exec(program, args, options); focused = false; return result; };
    expect((await perform(fresh, { type: "stage" }, switchedExec, () => focused)).ok).toBe(false);
    expect((await readSnapshot(context, exec)).groups.staged).toHaveLength(0);
  });

  test("conflicts remain visible and block staging and commit", async () => {
    const context = repo(), root = context.cwd;
    must(root, "switch", "-c", "side"); writeFileSync(join(root, "tracked.txt"), "side\n"); must(root, "commit", "-am", "Side");
    must(root, "switch", "main"); writeFileSync(join(root, "tracked.txt"), "main\n"); must(root, "commit", "-am", "Main");
    expect(git(root, "merge", "side").code).not.toBe(0);
    const snapshot = await readSnapshot(context, exec);
    expect(snapshot.groups.unstaged[0].status).toBe("U");
    expect((await perform(snapshot, { type: "stage" }, exec)).ok).toBe(false);
    expect((await perform(snapshot, { type: "commit", subject: "No" }, exec)).message).toContain("conflicts");
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
    await controller.refresh(); controller.setDraft("subject", "Keep my draft");
    writeFileSync(join(first.cwd, "tracked.txt"), "second edit\n");
    await controller.refresh(); expect(controller.diff?.some((r) => r.text === "second edit")).toBe(true);
    context = second; await controller.refresh(); expect(controller.draft().subject).toBe("");
    context = first; await controller.refresh(); expect(controller.draft().subject).toBe("Keep my draft");
    await controller.mutate({ type: "commit" }); expect(controller.draft().subject).toBe("Keep my draft");
    expect(controller.error).toContain("Stage changes");
    await controller.mutate({ type: "stage" }); await controller.mutate({ type: "commit" });
    expect(controller.draft().subject).toBe(""); controller.close();
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

  test("no-folder, non-repository, clean, stage-all, and unstage-all states use real Git", async () => {
    expect((await readSnapshot({}, exec)).state).toBe("nofolder");
    const outside = mkdtempSync(join(tmpdir(), "herdr-no-repo-")); roots.push(outside);
    expect((await readSnapshot({ cwd: outside }, exec)).state).toBe("norepo");
    const context = repo();
    expect((await readSnapshot(context, exec)).files).toHaveLength(0);
    rmSync(join(context.cwd, "tracked.txt")); writeFileSync(join(context.cwd, "new.txt"), "new\n");
    let snapshot = await readSnapshot(context, exec);
    expect((await perform(snapshot, { type: "stage" }, exec)).ok).toBe(true);
    snapshot = await readSnapshot(context, exec);
    expect(snapshot.groups.staged.map((file) => file.status).sort()).toEqual(["A", "D"]);
    expect((await perform(snapshot, { type: "unstage" }, exec)).ok).toBe(true);
    snapshot = await readSnapshot(context, exec);
    expect(snapshot.groups.staged).toHaveLength(0); expect(snapshot.groups.unstaged).toHaveLength(2);
  });
});
