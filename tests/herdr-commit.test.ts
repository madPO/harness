import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChangesController } from "../herdr/mods/t3-changes/controller.js";
import { perform, readPrevious, readSnapshot, type Exec } from "../herdr/mods/t3-changes/git.js";
import type { Location } from "../herdr/mods/t3-changes/model.js";

const roots: string[] = [];
const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };
function git(cwd: string, ...argv: string[]) {
  const result = Bun.spawnSync(["git", ...argv], { cwd, env });
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}
function must(cwd: string, ...argv: string[]) {
  const result = git(cwd, ...argv);
  if (result.code) throw new Error(result.stderr);
  return result.stdout;
}
const exec: Exec = async (program, argv, options) => {
  if (program !== "git" || options.on) throw new Error("Tests only execute local Git");
  return git(options.cwd, ...argv);
};
function directory() { const root = mkdtempSync(join(tmpdir(), "herdr-commit-")); roots.push(root); return root; }
function repo(initial = true) {
  const cwd = directory();
  must(cwd, "init", "-b", "main");
  must(cwd, "config", "user.name", "Changes test"); must(cwd, "config", "user.email", "changes@example.invalid");
  must(cwd, "config", "commit.gpgSign", "false"); must(cwd, "config", "core.hooksPath", "/dev/null");
  if (initial) {
    writeFileSync(join(cwd, "chosen.txt"), "base\n"); writeFileSync(join(cwd, "other.txt"), "other base\n");
    must(cwd, "add", "."); must(cwd, "commit", "-m", "Initial");
  }
  return { cwd, on: null };
}
function message(cwd: string) { const object = must(cwd, "cat-file", "commit", "HEAD"); return object.slice(object.indexOf("\n\n") + 2); }
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("selected commit semantics", () => {
  test("commits the full workingtree version without unrelated staged content", async () => {
    const context = repo(), root = context.cwd;
    writeFileSync(join(root, "chosen.txt"), "partial index\n"); must(root, "add", "chosen.txt");
    writeFileSync(join(root, "chosen.txt"), "complete workingtree\n");
    writeFileSync(join(root, "other.txt"), "unrelated index\n"); must(root, "add", "other.txt");
    writeFileSync(join(root, "other.txt"), "unrelated workingtree\n");
    const controller = new ChangesController({ exec, location: () => context });
    try {
      await controller.refresh();
      expect(controller.files().filter((file) => file.path === "chosen.txt")).toHaveLength(1);
      expect(controller.files().find((file) => file.path === "chosen.txt")?.group).toBe("unstaged");
      controller.toggleFiles(["chosen.txt"]); controller.setDraft("Selected commit");
      await controller.mutate({ type: "commit" }); expect(controller.error).toBeNull();
      expect(must(root, "show", "HEAD:chosen.txt")).toBe("complete workingtree\n");
      expect(must(root, "show", "HEAD:other.txt")).toBe("other base\n");
      expect(must(root, "show", ":other.txt")).toBe("unrelated index\n");
      expect(readFileSync(join(root, "other.txt"), "utf8")).toBe("unrelated workingtree\n");
    } finally { controller.close(); }
  });

  test("commits literal untracked and deleted names without expanding pathspecs", async () => {
    const context = repo(), root = context.cwd, removed = "-gone [a]*\n.txt", added = ":(glob)* [z]\n.txt";
    writeFileSync(join(root, removed), "old\n"); must(root, "--literal-pathspecs", "add", "--", removed); must(root, "commit", "-m", "Names");
    rmSync(join(root, removed)); writeFileSync(join(root, added), "new\n"); writeFileSync(join(root, "untouched.txt"), "keep\n");
    const result = await perform(await readSnapshot(context, exec), { type: "commit", paths: [removed, added], message: "Literal files" }, exec);
    expect(result.ok).toBe(true);
    expect(must(root, "show", `HEAD:${added}`)).toBe("new\n");
    expect(must(root, "ls-tree", "-r", "--name-only", "-z", "HEAD").split("\0")).not.toContain(removed);
    expect((await readSnapshot(context, exec)).files.map((file) => file.path)).toEqual(["untouched.txt"]);
  });

  test("selection is opt-in, survives refresh without arrivals, and resets across contexts", async () => {
    const base = repo(); let context: Location = { ...base, space: "a" };
    writeFileSync(join(base.cwd, "chosen.txt"), "dirty\n"); writeFileSync(join(base.cwd, "other.txt"), "dirty\n");
    const controller = new ChangesController({ exec, location: () => context });
    try {
      await controller.refresh();
      expect(controller.checked.size).toBe(0);
      controller.toggleFiles(["chosen.txt"]);
      writeFileSync(join(base.cwd, "arriving.txt"), "new\n"); await controller.refresh();
      expect([...controller.checked]).toEqual(["chosen.txt"]);
      expect(controller.checked.has("arriving.txt")).toBe(false);
      controller.toggleFiles(["chosen.txt"]); await controller.refresh();
      expect(controller.checked.size).toBe(0);
      controller.toggleFiles(["other.txt"]);
      writeFileSync(join(base.cwd, "other.txt"), "other base\n"); await controller.refresh();
      expect(controller.checked.size).toBe(0);
      controller.toggleFiles(["chosen.txt"]);
      context = { ...base, space: "b" }; await controller.refresh(); expect(controller.checked.size).toBe(0);
    } finally { controller.close(); }
  });
});

describe("amend state and history", () => {
  test("loads an exact root message and rewrites HEAD without adding history", async () => {
    const context = repo(false), root = context.cwd, original = "\n  Root  \n\n# exact\nDetail\t \n\n";
    writeFileSync(join(root, "root.txt"), "root content\n"); must(root, "add", "."); must(root, "commit", "--cleanup=verbatim", "-m", original);
    const controller = new ChangesController({ exec, location: () => context });
    try {
      await controller.refresh(); controller.setDraft("Normal draft"); await controller.setAmend(true);
      expect(controller.amend).toBe(true); expect(controller.draft().message).toBe(original);
      expect(controller.files().map((file) => file.path)).toEqual(["root.txt"]); expect(controller.checked.has("root.txt")).toBe(false);
      const replacement = "\n  Rewritten root\n\n# preserve\n\n";
      controller.setDraft(replacement); await controller.mutate({ type: "commit" });
      expect(controller.error).toBeNull(); expect(controller.amend).toBe(false); expect(controller.draft().message).toBe("Normal draft");
      expect(message(root)).toBe(replacement); expect(must(root, "rev-list", "--count", "HEAD").trim()).toBe("1");
      expect(must(root, "show", "HEAD:root.txt")).toBe("root content\n");
    } finally { controller.close(); }
  });

  test("prior deletions start unchecked and can be included without invalid pathspecs", async () => {
    const context = repo(), root = context.cwd;
    rmSync(join(root, "chosen.txt")); must(root, "commit", "-am", "Delete chosen");
    const controller = new ChangesController({ exec, location: () => context });
    try {
      await controller.refresh(); await controller.setAmend(true);
      const deleted = controller.files().find((file) => file.path === "chosen.txt");
      expect(deleted?.status).toBe("D"); expect(controller.checked.has("chosen.txt")).toBe(false);
      controller.toggleFiles(["chosen.txt"]);
      controller.setDraft("Still deleted"); await controller.mutate({ type: "commit" });
      expect(controller.error).toBeNull(); expect(must(root, "rev-list", "--count", "HEAD").trim()).toBe("2");
      expect(git(root, "show", "HEAD:chosen.txt").code).not.toBe(0);
    } finally { controller.close(); }
  });

  test("unchecked previous entries remain baseline and disabling restores normal selection and draft", async () => {
    const context = repo(), root = context.cwd;
    writeFileSync(join(root, "chosen.txt"), "dirty\n");
    const controller = new ChangesController({ exec, location: () => context });
    try {
      await controller.refresh(); controller.toggleFiles(["chosen.txt"]); controller.setDraft("Normal draft");
      await controller.setAmend(true); expect(controller.checked.has("chosen.txt")).toBe(true);
      expect(controller.checked.has("other.txt")).toBe(false);
      controller.setDraft("Temporary amend draft"); await controller.setAmend(false);
      expect(controller.draft().message).toBe("Normal draft"); expect(controller.checked.has("chosen.txt")).toBe(true);
      expect(controller.files().map((file) => file.path)).toEqual(["chosen.txt"]);
      await controller.setAmend(true); controller.toggleFiles(["chosen.txt"]);
      controller.setDraft("Message only"); await controller.mutate({ type: "commit" });
      expect(controller.error).toBeNull(); expect(must(root, "show", "HEAD:chosen.txt")).toBe("base\n");
      expect(readFileSync(join(root, "chosen.txt"), "utf8")).toBe("dirty\n");
    } finally { controller.close(); }
  });

  test("merge amend lists previous changes against the first parent", async () => {
    const context = repo(), root = context.cwd;
    must(root, "switch", "-c", "side"); writeFileSync(join(root, "side.txt"), "side\n"); must(root, "add", "."); must(root, "commit", "-m", "Side");
    must(root, "switch", "main"); writeFileSync(join(root, "main.txt"), "main\n"); must(root, "add", "."); must(root, "commit", "-m", "Main");
    must(root, "merge", "--no-ff", "side", "-m", "Merge");
    const previous = await readPrevious(await readSnapshot(context, exec), exec);
    expect(previous.files.map((file) => file.path)).toEqual(["side.txt"]);
  });

  test("rapid disable and context transitions reject pending amend results", async () => {
    const base = repo(); let context: Location = { ...base, space: "a" }, hold = false;
    let entered = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
    const delayed: Exec = async (program, argv, options) => {
      const result = await exec(program, argv, options);
      if (hold && argv.includes("cat-file")) { hold = false; entered.resolve(); await resume.promise; }
      return result;
    };
    const controller = new ChangesController({ exec: delayed, location: () => context });
    try {
      await controller.refresh(); controller.setDraft("Normal draft"); hold = true;
      const obsolete = controller.setAmend(true); await entered.promise; await controller.setAmend(false);
      await controller.setAmend(true); expect(controller.amend).toBe(true);
      resume.resolve(); await obsolete; expect(controller.amend).toBe(true);
      await controller.setAmend(false); hold = true; entered = Promise.withResolvers<void>(); resume = Promise.withResolvers<void>();
      const switched = controller.setAmend(true); await entered.promise;
      context = { ...base, space: "b" }; await controller.refresh(); resume.resolve(); await switched;
      expect(controller.amend).toBe(false); expect(controller.draft().message).toBe("Normal draft"); expect(controller.loading).toBe(false);
    } finally { resume.resolve(); controller.close(); }
  });

  test("external HEAD changes invalidate amend and stale mutations", async () => {
    const context = repo(), root = context.cwd;
    const controller = new ChangesController({ exec, location: () => context });
    try {
      await controller.refresh(); controller.setDraft("Normal"); await controller.setAmend(true); controller.setDraft("Unexpected");
      must(root, "commit", "--allow-empty", "-m", "External"); const external = must(root, "rev-parse", "HEAD");
      await controller.mutate({ type: "commit" });
      expect(controller.error).not.toBeNull(); expect(must(root, "rev-parse", "HEAD")).toBe(external);
      expect(controller.amend).toBe(false); expect(controller.draft().message).toBe("Normal");
    } finally { controller.close(); }
  });

  test("an unborn repository cannot enable amend", async () => {
    const context = repo(false), controller = new ChangesController({ exec, location: () => context });
    try { await controller.refresh(); await controller.setAmend(true); expect(controller.amend).toBe(false); expect(controller.error).not.toBeNull(); }
    finally { controller.close(); }
  });
});

describe("selected stash and rollback", () => {
  test("stashes selected literal paths and untracked files without touching unrelated changes", async () => {
    const context = repo(), root = context.cwd, added = "new [x]*\n.txt";
    writeFileSync(join(root, "chosen.txt"), "selected\n");
    writeFileSync(join(root, "other.txt"), "other staged\n"); must(root, "add", "other.txt"); writeFileSync(join(root, "other.txt"), "other work\n");
    writeFileSync(join(root, added), "new selected\n"); writeFileSync(join(root, "keep.txt"), "new keep\n");
    const result = await perform(await readSnapshot(context, exec), { type: "stash", paths: ["chosen.txt", added] }, exec);
    expect(result.ok).toBe(true); expect(readFileSync(join(root, "chosen.txt"), "utf8")).toBe("base\n"); expect(existsSync(join(root, added))).toBe(false);
    expect(must(root, "show", ":other.txt")).toBe("other staged\n"); expect(readFileSync(join(root, "other.txt"), "utf8")).toBe("other work\n");
    expect(readFileSync(join(root, "keep.txt"), "utf8")).toBe("new keep\n");
    expect(must(root, "show", `stash@{0}^3:${added}`)).toBe("new selected\n");
    expect(must(root, "show", "stash@{0}:chosen.txt")).toBe("selected\n");
  });

  test("confirmed rollback restores selected index and worktree while preserving unrelated paths", async () => {
    const context = repo(), root = context.cwd, added = "-new [x]*\n.txt";
    writeFileSync(join(root, "chosen.txt"), "selected index\n"); must(root, "add", "chosen.txt"); writeFileSync(join(root, "chosen.txt"), "selected work\n");
    writeFileSync(join(root, "other.txt"), "other index\n"); must(root, "add", "other.txt"); writeFileSync(join(root, "other.txt"), "other work\n");
    writeFileSync(join(root, added), "selected addition\n"); must(root, "--literal-pathspecs", "add", "--", added);
    mkdirSync(join(root, "nested")); writeFileSync(join(root, "nested", "remove.txt"), "remove\n"); writeFileSync(join(root, "nested", "keep.txt"), "keep\n");
    const snapshot = await readSnapshot(context, exec), paths = ["chosen.txt", added, "nested/remove.txt"];
    expect((await perform(snapshot, { type: "rollback", paths }, exec)).ok).toBe(false);
    expect(readFileSync(join(root, "chosen.txt"), "utf8")).toBe("selected work\n");
    expect((await perform(snapshot, { type: "rollback", paths, confirmed: true }, exec)).ok).toBe(true);
    expect(readFileSync(join(root, "chosen.txt"), "utf8")).toBe("base\n"); expect(must(root, "show", ":chosen.txt")).toBe("base\n");
    expect(existsSync(join(root, added))).toBe(false); expect(existsSync(join(root, "nested/remove.txt"))).toBe(false);
    expect(readFileSync(join(root, "nested/keep.txt"), "utf8")).toBe("keep\n");
    expect(must(root, "show", ":other.txt")).toBe("other index\n"); expect(readFileSync(join(root, "other.txt"), "utf8")).toBe("other work\n");
  });

  test("rejects a stale confirmation and prior-only stash or rollback", async () => {
    const context = repo(), root = context.cwd, controller = new ChangesController({ exec, location: () => context });
    try {
      writeFileSync(join(root, "chosen.txt"), "keep\n"); await controller.refresh();
      controller.toggleFiles(["chosen.txt"]);
      const paths = [...controller.checked]; controller.toggleFiles(paths);
      await controller.mutate({ type: "rollback", paths, confirmed: true });
      expect(controller.error).not.toBeNull(); expect(readFileSync(join(root, "chosen.txt"), "utf8")).toBe("keep\n");
      const snapshot = await readSnapshot(context, exec);
      expect((await perform(snapshot, { type: "stash", paths: ["other.txt"] }, exec)).ok).toBe(false);
      expect((await perform(snapshot, { type: "rollback", paths: ["other.txt"], confirmed: true }, exec)).ok).toBe(false);
    } finally { controller.close(); }
  });

  test("a focus change between rollback writes prevents remaining mutations", async () => {
    const context = repo(), root = context.cwd; let focused = true;
    writeFileSync(join(root, "chosen.txt"), "restore\n"); writeFileSync(join(root, "new.txt"), "keep after focus switch\n");
    const guarded: Exec = async (program, argv, options) => {
      const result = await exec(program, argv, options);
      if (argv.includes("restore")) focused = false;
      return result;
    };
    const result = await perform(await readSnapshot(context, exec), { type: "rollback", paths: ["chosen.txt", "new.txt"], confirmed: true }, guarded, () => focused);
    expect(result.ok).toBe(false); expect(result.attempted).toBe(true);
    expect(readFileSync(join(root, "new.txt"), "utf8")).toBe("keep after focus switch\n");
  });
});

describe("commit and push outcomes", () => {
  test("pushes a selected commit to a bare local remote", async () => {
    const context = repo(), root = context.cwd, remote = directory(); must(remote, "init", "--bare");
    must(root, "remote", "add", "origin", remote); must(root, "push", "-u", "origin", "main");
    writeFileSync(join(root, "chosen.txt"), "push selected\n");
    const result = await perform(await readSnapshot(context, exec), { type: "commit", paths: ["chosen.txt"], message: "Push selected", push: true }, exec);
    expect(result.ok).toBe(true); expect(result.committed).toBe(true);
    expect(must(remote, "rev-parse", "refs/heads/main")).toBe(must(root, "rev-parse", "HEAD"));
  });

  test("a rejected push preserves local success, clears the draft, and exits amend", async () => {
    const context = repo(), root = context.cwd, remote = directory(); must(remote, "init", "--bare");
    must(root, "remote", "add", "origin", remote); must(root, "push", "-u", "origin", "main");
    must(remote, "config", "receive.denyNonFastForwards", "true");
    const controller = new ChangesController({ exec, location: () => context });
    try {
      await controller.refresh(); await controller.setAmend(true); controller.setDraft("Rewritten local root");
      const old = must(root, "rev-parse", "HEAD"); await controller.mutate({ type: "commit", push: true });
      expect(must(root, "rev-parse", "HEAD")).not.toBe(old); expect(message(root)).toBe("Rewritten local root\n");
      expect(controller.error).not.toBeNull(); expect(controller.error).toContain("Local commit succeeded");
      expect(controller.draft().message).toBe(""); expect(controller.amend).toBe(false);
      expect(must(remote, "rev-parse", "refs/heads/main")).toBe(old);
      expect(must(root, "rev-list", "--count", "HEAD").trim()).toBe("1");
    } finally { controller.close(); }
  });
});

test("rollback refuses submodule entries without removing their directories", async () => {
  const context = repo(), root = context.cwd, head = must(root, "rev-parse", "HEAD").trim();
  must(root, "update-index", "--add", "--cacheinfo", `160000,${head},module`);
  mkdirSync(join(root, "module")); writeFileSync(join(root, "module", "keep.txt"), "submodule contents\n");
  const result = await perform(await readSnapshot(context, exec), { type: "rollback", paths: ["module"], confirmed: true }, exec);
  expect(result.ok).toBe(false); expect(result.attempted).toBe(false);
  expect(readFileSync(join(root, "module", "keep.txt"), "utf8")).toBe("submodule contents\n");
  expect(must(root, "ls-files", "--stage", "--", "module")).toContain("160000");
});

test("an intent-to-add failure is reported without committing or resetting unrelated staging", async () => {
  const context = repo(), root = context.cwd;
  writeFileSync(join(root, "new.txt"), "selected\n");
  writeFileSync(join(root, "other.txt"), "keep index\n"); must(root, "add", "other.txt");
  const before = must(root, "rev-parse", "HEAD"), writes: string[][] = [];
  const rejecting: Exec = async (program, argv, options) => {
    if (argv.includes("add") && argv.includes("--intent-to-add")) {
      writes.push(argv); return { code: 1, stdout: "", stderr: "Intent to add failed" };
    }
    if (argv.includes("commit") || argv.includes("reset")) writes.push(argv);
    return exec(program, argv, options);
  };
  const result = await perform(await readSnapshot(context, exec), { type: "commit", paths: ["new.txt"], message: "Not committed" }, rejecting);
  expect(result.ok).toBe(false); expect(result.committed).toBe(false); expect(result.attempted).toBe(true);
  expect(writes).toHaveLength(1); expect(must(root, "rev-parse", "HEAD")).toBe(before);
  expect(must(root, "show", ":other.txt")).toBe("keep index\n");
});

test("successful amend retains message edits entered while Git is running", async () => {
  const context = repo(), root = context.cwd;
  const entered = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
  const delayed: Exec = async (program, argv, options) => {
    if (argv.includes("--only") && argv.includes("--amend")) { entered.resolve(); await resume.promise; }
    return exec(program, argv, options);
  };
  const controller = new ChangesController({ exec: delayed, location: () => context });
  let pending: Promise<void> | undefined;
  try {
    await controller.refresh(); controller.setDraft("Saved normal draft"); await controller.setAmend(true);
    controller.setDraft("Submitted amendment"); pending = controller.mutate({ type: "commit" });
    await entered.promise; controller.setDraft("Edited during amendment"); resume.resolve(); await pending;
    expect(controller.error).toBeNull(); expect(controller.amend).toBe(false);
    expect(controller.draft().message).toBe("Edited during amendment"); expect(message(root)).toBe("Submitted amendment\n");
  } finally { resume.resolve(); await pending; controller.close(); }
});

test("rollback never cleans a directory replacing a selected staged addition", async () => {
  const context = repo(), root = context.cwd;
  writeFileSync(join(root, "replacement"), "staged file\n"); must(root, "add", "replacement");
  rmSync(join(root, "replacement")); mkdirSync(join(root, "replacement"));
  writeFileSync(join(root, "replacement", "keep.txt"), "must survive\n");
  const result = await perform(await readSnapshot(context, exec), { type: "rollback", paths: ["replacement"], confirmed: true }, exec);
  expect(result.ok).toBe(false);
  expect(readFileSync(join(root, "replacement", "keep.txt"), "utf8")).toBe("must survive\n");
});

test("rollback removes only the explicitly selected ignored addition", async () => {
  const context = repo(), root = context.cwd;
  writeFileSync(join(root, ".gitignore"), "*.ignored\n"); must(root, "add", ".gitignore"); must(root, "commit", "-m", "Ignore files");
  writeFileSync(join(root, "selected.ignored"), "selected\n"); writeFileSync(join(root, "other.ignored"), "preserve\n");
  must(root, "add", "--force", "--", "selected.ignored");
  const result = await perform(await readSnapshot(context, exec), { type: "rollback", paths: ["selected.ignored"], confirmed: true }, exec);
  expect(result.ok).toBe(true); expect(existsSync(join(root, "selected.ignored"))).toBe(false);
  expect(readFileSync(join(root, "other.ignored"), "utf8")).toBe("preserve\n");
  expect(must(root, "ls-files", "-z", "--", "selected.ignored")).toBe("");
});
