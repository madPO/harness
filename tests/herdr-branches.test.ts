import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { branchTree, contextKey, parseRefs, repositoryKey, treeRows, type Branch, type Location } from "../herdr/mods/t3-branches/model.js";
import { readSnapshot, READ, REFS, type Exec, type GitResult } from "../herdr/mods/t3-branches/git.js";
import { BranchesController } from "../herdr/mods/t3-branches/controller.js";
import { resolveContext } from "../herdr/mods/t3-branches/context.js";

const roots: string[] = [];
const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };
function git(cwd: string, ...argv: string[]): GitResult {
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
function directory() {
  const root = mkdtempSync(join(tmpdir(), "herdr-branches-"));
  roots.push(root);
  return root;
}
function repo(initial = true): Location & { cwd: string } {
  const cwd = directory();
  must(cwd, "init", "-b", "main");
  must(cwd, "config", "user.name", "Branches test");
  must(cwd, "config", "user.email", "branches@example.invalid");
  must(cwd, "config", "commit.gpgSign", "false");
  must(cwd, "config", "core.hooksPath", "/dev/null");
  if (initial) {
    writeFileSync(join(cwd, "tracked.txt"), "base\n");
    must(cwd, "add", ".");
    must(cwd, "commit", "-m", "Initial");
  }
  return { space: "first", cwd, on: null };
}
const branch = (name: string, kind: Branch["kind"] = "local", current = false): Branch => ({
  ref: `${kind === "local" ? "refs/heads" : "refs/remotes"}/${name}`, name, kind, current,
});
const ok = (stdout: string): GitResult => ({ code: 0, stdout, stderr: "" });
const failure = (stderr: string): GitResult => ({ code: 128, stdout: "", stderr });
function persistence() {
  const values = new Map<string, string[]>();
  return {
    values,
    loadPins: (key: string) => [...(values.get(key) ?? [])],
    savePins: (key: string, refs: string[]) => { values.set(key, [...refs]); },
  };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("Branches pure model", () => {
  test("empty roots stay ordered, including empty Pinned", () => {
    const tree = branchTree([], new Set());
    expect(tree.map((node) => [node.name, node.children])).toEqual([["Pinned", []], ["Local", []], ["Remote", []]]);
    expect(treeRows(tree, new Set()).map((row) => row.depth)).toEqual([0, 0, 0]);
  });

  test("slash segments stay expanded and folder/leaf collisions retain unique IDs", () => {
    const branches = [branch("zeta"), branch("a"), branch("a/b/deep"), branch("origin/a/b", "remote"), branch("a/b")];
    const tree = branchTree(branches, new Set());
    expect(tree[1].children?.map((node) => [node.name, Boolean(node.branch)])).toEqual([["a", false], ["a", true], ["zeta", true]]);
    const rows = treeRows(tree, new Set());
    expect(rows.map((row) => [row.name, row.depth])).toEqual([
      ["Pinned", 0], ["Local", 0], ["a", 1], ["b", 2], ["deep", 3], ["b", 2], ["a", 1], ["zeta", 1],
      ["Remote", 0], ["origin", 1], ["a", 2], ["b", 3],
    ]);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    const folder = rows.find((row) => row.name === "a" && row.depth === 1 && row.children)!;
    const collapsed = treeRows(tree, new Set([folder.id]));
    expect(collapsed.filter((row) => row.branch).map((row) => row.branch?.name)).toEqual(["a", "zeta", "origin/a/b"]);
    expect(treeRows(tree, new Set(tree.map((node) => node.id))).map((row) => row.name)).toEqual(["Pinned", "Local", "Remote"]);
  });

  test("pins duplicate local and remote branches without collisions or input mutation", () => {
    const local = branch("origin/topic", "local", true), remote = branch("origin/topic", "remote");
    const branches = [remote, branch("z"), local, branch("a/deep")];
    const before = JSON.stringify(branches), pins = new Set([local.ref, remote.ref, "refs/heads/deleted"]);
    const tree = branchTree(branches, pins), rows = treeRows(tree, new Set());
    expect(tree[0].children?.map((node) => node.name)).toEqual(["Local", "Remote"]);
    expect(rows.filter((row) => row.branch?.ref === local.ref)).toHaveLength(2);
    expect(rows.filter((row) => row.branch?.ref === remote.ref)).toHaveLength(2);
    expect(rows.filter((row) => row.branch?.current)).toHaveLength(2);
    expect(rows.some((row) => row.branch?.ref === "refs/heads/deleted")).toBe(false);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    expect(branchTree([...branches].reverse(), pins)).toEqual(tree);
    expect(JSON.stringify(branches)).toBe(before);
    expect([...pins]).toEqual([local.ref, remote.ref, "refs/heads/deleted"]);
  });

  test("machine-readable refs preserve names, current locals, and non-symbolic HEAD names", () => {
    expect(parseRefs("refs/heads/team/café+fix\0\0*\nrefs/remotes/origin/team/café+fix\0\0 \nrefs/remotes/origin/HEAD\0refs/remotes/origin/main\0 \nrefs/remotes/other/HEAD\0\0 \n"))
      .toEqual([branch("team/café+fix", "local", true), branch("origin/team/café+fix", "remote"), branch("other/HEAD", "remote")]);
    expect(parseRefs("")).toEqual([]);
    expect(() => parseRefs("refs/heads/main\0\0*")).toThrow("incomplete");
    expect(() => parseRefs("refs/tags/v1\0\0 \n")).toThrow("unexpected");
    expect(() => parseRefs("refs/heads/main\0 \n")).toThrow("invalid");
    expect(() => parseRefs("refs/heads/\0\0 \n")).toThrow("invalid");
    expect(() => parseRefs("refs/heads/main\0\0?\n")).toThrow("invalid");
  });

  test("context identity includes focus while repository identity includes only machine and root", () => {
    const first = { space: "a", cwd: "/repo/sub", on: null };
    const snapshot = { ...first, root: "/repo", state: "ready" as const, branches: [] };
    expect(contextKey(first)).not.toBe(contextKey({ ...first, space: "b" }));
    expect(contextKey(first)).not.toBe(contextKey({ ...first, on: "other" }));
    expect(repositoryKey(snapshot)).toBe(repositoryKey({ ...snapshot, space: "b", cwd: "/repo" }));
    expect(repositoryKey(snapshot)).not.toBe(repositoryKey({ ...snapshot, on: "other" }));
    expect(repositoryKey(snapshot)).not.toBe(repositoryKey({ ...snapshot, root: "/different" }));
  });
});

describe("Branches Git boundary", () => {
  test("real refs include nested local and remote branches and exclude symbolic remote HEAD", async () => {
    const context = repo();
    must(context.cwd, "branch", "team/feature/ui");
    must(context.cwd, "branch", "team/café+fix");
    must(context.cwd, "update-ref", "refs/remotes/origin/team/feature/ui", "HEAD");
    must(context.cwd, "update-ref", "refs/remotes/origin/main", "HEAD");
    must(context.cwd, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    const sub = join(context.cwd, "sub"); mkdirSync(sub);
    const snapshot = await readSnapshot({ ...context, cwd: sub }, exec);
    expect(snapshot.state).toBe("ready");
    expect(snapshot.root).toBe(context.cwd);
    expect(snapshot.cwd).toBe(sub);
    expect(snapshot.branches).toEqual([
      branch("main", "local", true), branch("team/café+fix"), branch("team/feature/ui"),
      branch("origin/main", "remote"), branch("origin/team/feature/ui", "remote"),
    ]);
    must(context.cwd, "switch", "--detach", "HEAD");
    expect((await readSnapshot(context, exec)).branches.every((item) => !item.current)).toBe(true);
  });

  test("no-folder, non-repository, bare, and unborn repositories stay distinct from read errors", async () => {
    const noFolder: Location = { space: null, cwd: null, on: null };
    const never: Exec = async () => { throw new Error("Unexpected Git invocation"); };
    expect(await readSnapshot(noFolder, never)).toEqual({ ...noFolder, state: "nofolder", branches: [] });
    const ordinary = { ...noFolder, cwd: directory() };
    expect(await readSnapshot(ordinary, exec)).toEqual({ ...ordinary, state: "norepo", branches: [] });
    const unborn = repo(false);
    expect(await readSnapshot(unborn, exec)).toEqual({ ...unborn, root: unborn.cwd, state: "ready", branches: [] });
    const bare = directory(); must(bare, "init", "--bare");
    expect((await readSnapshot({ ...noFolder, cwd: bare }, exec)).state).toBe("norepo");
    const denied: Exec = async () => failure("fatal: detected dubious ownership in repository");
    await expect(readSnapshot(unborn, denied)).rejects.toThrow("dubious ownership");
    const corrupt: Exec = async (_program, argv) => argv.includes("rev-parse") ? ok(`${unborn.cwd}\n`) : failure("fatal: broken ref");
    await expect(readSnapshot(unborn, corrupt)).rejects.toThrow("broken ref");
  });

  test("argv reads route the selected machine and resolved root without shell commands", async () => {
    const calls: { program: string; argv: string[]; cwd: string; on?: string | null }[] = [];
    const routed: Exec = async (program, argv, options) => {
      calls.push({ program, argv, ...options });
      return argv.includes("rev-parse") ? ok("/root with spaces\n") : ok("refs/heads/main\0\0*\n");
    };
    const snapshot = await readSnapshot({ space: "remote", cwd: "/start;not-a-shell", on: "machine" }, routed);
    expect(snapshot.branches).toEqual([branch("main", "local", true)]);
    expect(calls).toEqual([
      { program: "git", argv: [...READ, "rev-parse", "--show-toplevel"], cwd: "/start;not-a-shell", on: "machine" },
      { program: "git", argv: [...READ, ...REFS], cwd: "/root with spaces", on: "machine" },
    ]);
  });
});

describe("Branches controller", () => {
  test("refresh observes external ref creation, deletion, and current-branch changes", async () => {
    const context = repo(), store = persistence();
    const controller = new BranchesController({ exec, location: () => context, ...store });
    await controller.refresh();
    expect(controller.snapshot?.branches).toEqual([branch("main", "local", true)]);
    must(context.cwd, "switch", "-c", "external/topic");
    must(context.cwd, "update-ref", "refs/remotes/origin/external/topic", "HEAD");
    await controller.refresh();
    expect(controller.snapshot?.branches).toEqual([
      branch("external/topic", "local", true), branch("main"), branch("origin/external/topic", "remote"),
    ]);
    must(context.cwd, "update-ref", "-d", "refs/remotes/origin/external/topic");
    await controller.refresh();
    expect(controller.snapshot?.branches.map((item) => item.ref)).not.toContain("refs/remotes/origin/external/topic");
    expect(controller.error).toBeNull();
    expect(controller.loading).toBe(false);
    controller.close();
  });

  test("persisted full-ref pins isolate repositories and machines but follow repository subfolders", async () => {
    const first = repo(), second = repo(), store = persistence();
    must(first.cwd, "update-ref", "refs/remotes/origin/main", "HEAD");
    let context: Location = first;
    const routed: Exec = async (program, argv, options) => exec(program, argv, { ...options, on: null });
    const controller = new BranchesController({ exec: routed, location: () => context, ...store });
    await controller.refresh();
    controller.togglePin(branch("main")); controller.togglePin(branch("origin/main", "remote"));
    const refs = ["refs/heads/main", "refs/remotes/origin/main"];
    expect([...controller.pins].sort()).toEqual(refs);
    const sub = join(first.cwd, "sub"); mkdirSync(sub);
    context = { ...first, space: "another-space", cwd: sub };
    await controller.refresh();
    expect([...controller.pins].sort()).toEqual(refs);
    context = second; await controller.refresh();
    expect(controller.pins.size).toBe(0);
    controller.togglePin(branch("main"));
    context = { ...first, on: "other-machine" }; await controller.refresh();
    expect(controller.pins.size).toBe(0);
    context = first; await controller.refresh();
    expect([...controller.pins].sort()).toEqual(refs);
    controller.close();
    const reopened = new BranchesController({ exec, location: () => first, ...store });
    await reopened.refresh();
    expect([...reopened.pins].sort()).toEqual(refs);
    reopened.togglePin(branch("main"));
    expect([...reopened.pins]).toEqual(["refs/remotes/origin/main"]);
    reopened.close();
  });

  test("deleted pins stay persisted but hidden, and only existing refs can be pinned", async () => {
    const context = repo(), store = persistence();
    must(context.cwd, "branch", "temporary/topic");
    const controller = new BranchesController({ exec, location: () => context, ...store });
    await controller.refresh(); controller.togglePin(branch("temporary/topic"));
    must(context.cwd, "branch", "-D", "temporary/topic");
    await controller.refresh();
    expect(controller.pins.has("refs/heads/temporary/topic")).toBe(true);
    expect(branchTree(controller.snapshot!.branches, controller.pins)[0].children).toEqual([]);
    controller.togglePin(branch("does-not-exist")); controller.togglePin(branch("main"));
    expect(store.values.get(repositoryKey(controller.snapshot!))).toEqual(["refs/heads/main", "refs/heads/temporary/topic"]);
    must(context.cwd, "branch", "temporary/topic"); await controller.refresh();
    expect(treeRows(branchTree(controller.snapshot!.branches, controller.pins), new Set()).filter((row) => row.branch?.name === "temporary/topic")).toHaveLength(2);
    controller.close();
  });

  test("newer overlapping refresh wins and older completion cannot reset loading or data", async () => {
    const context: Location = { space: "a", cwd: "/repo", on: null }, store = persistence();
    const first = Promise.withResolvers<GitResult>(), second = Promise.withResolvers<GitResult>();
    const enteredFirst = Promise.withResolvers<void>(), enteredSecond = Promise.withResolvers<void>();
    let reads = 0;
    const delayed: Exec = async (_program, argv) => {
      if (argv.includes("rev-parse")) return ok("/repo\n");
      if (++reads === 1) { enteredFirst.resolve(); return first.promise; }
      enteredSecond.resolve(); return second.promise;
    };
    const controller = new BranchesController({ exec: delayed, location: () => context, ...store });
    const old = controller.refresh(); await enteredFirst.promise;
    const fresh = controller.refresh(); await enteredSecond.promise;
    first.resolve(ok("refs/heads/old\0\0*\n")); await old;
    expect(controller.loading).toBe(true);
    expect(controller.snapshot).toBeNull();
    second.resolve(ok("refs/heads/new\0\0*\n")); await fresh;
    expect(controller.snapshot?.branches).toEqual([branch("new", "local", true)]);
    expect(controller.loading).toBe(false);
    controller.close();
  });

  test("an older successful read cannot overwrite a newer completed refresh", async () => {
    const context: Location = { space: "a", cwd: "/repo", on: null }, store = persistence();
    const held = Promise.withResolvers<GitResult>(), entered = Promise.withResolvers<void>();
    let reads = 0;
    const delayed: Exec = async (_program, argv) => {
      if (argv.includes("rev-parse")) return ok("/repo\n");
      if (++reads === 1) { entered.resolve(); return held.promise; }
      return ok("refs/heads/new\0\0*\n");
    };
    const controller = new BranchesController({ exec: delayed, location: () => context, ...store });
    const old = controller.refresh(); await entered.promise;
    await controller.refresh(); controller.togglePin(branch("new"));
    held.resolve(ok("refs/heads/old\0\0*\n")); await old;
    expect(controller.snapshot?.branches).toEqual([branch("new", "local", true)]);
    expect([...controller.pins]).toEqual(["refs/heads/new"]);
    expect(controller.loading).toBe(false);
    controller.close();
  });

  test("context transition synchronously clears state and rejects older results and errors", async () => {
    const first: Location = { space: "a", cwd: "/first", on: null };
    let context = first;
    const held = Promise.withResolvers<GitResult>(), entered = Promise.withResolvers<void>(), store = persistence();
    let holdFirst = false;
    const delayed: Exec = async (_program, argv, options) => {
      if (argv.includes("rev-parse")) return ok(`${options.cwd}\n`);
      if (options.cwd === "/first") {
        if (holdFirst) { entered.resolve(); return held.promise; }
        return ok("refs/heads/first\0\0*\n");
      }
      return ok("refs/heads/second\0\0*\n");
    };
    const controller = new BranchesController({ exec: delayed, location: () => context, ...store });
    await controller.refresh(); controller.togglePin(branch("first"));
    expect(controller.snapshot?.root).toBe("/first"); expect(controller.pins.size).toBe(1);
    holdFirst = true;
    const old = controller.refresh(); await entered.promise;
    context = { space: "b", cwd: "/second", on: "remote" };
    expect(controller.transition()).toBe(true);
    expect(controller.snapshot).toBeNull(); expect(controller.pins.size).toBe(0); expect(controller.loading).toBe(false);
    await controller.refresh(); controller.togglePin(branch("second"));
    held.resolve(failure("obsolete failure")); await old;
    expect(controller.snapshot?.root).toBe("/second");
    expect([...controller.pins]).toEqual(["refs/heads/second"]);
    expect(controller.error).toBeNull();
    expect(controller.transition()).toBe(false);
    controller.close();
  });

  test("close rejects pending reads without notifying or loading persisted pins", async () => {
    const context: Location = { space: "a", cwd: "/repo", on: null };
    const held = Promise.withResolvers<GitResult>(), entered = Promise.withResolvers<void>();
    let changes = 0, loads = 0;
    const delayed: Exec = async (_program, argv) => {
      if (argv.includes("rev-parse")) return ok("/repo\n");
      entered.resolve(); return held.promise;
    };
    const controller = new BranchesController({ exec: delayed, location: () => context, changed: () => changes++, loadPins: () => { loads++; return []; }, savePins: () => {} });
    const pending = controller.refresh(); await entered.promise;
    controller.close(); const before = changes;
    held.resolve(ok("refs/heads/main\0\0*\n")); await pending;
    await controller.refresh(); controller.togglePin(branch("main"));
    expect(controller.snapshot).toBeNull(); expect(controller.loading).toBe(false);
    expect(changes).toBe(before); expect(loads).toBe(0);
  });

  test("read errors remain visible and successful refresh clears the error", async () => {
    const context: Location = { space: "a", cwd: "/repo", on: null }, store = persistence();
    let broken = true;
    const failing: Exec = async (_program, argv) => argv.includes("rev-parse") ? ok("/repo\n")
      : broken ? failure("fatal: cannot read refs") : ok("refs/heads/main\0\0*\n");
    const controller = new BranchesController({ exec: failing, location: () => context, ...store });
    await controller.refresh();
    expect(controller.error).toContain("cannot read refs"); expect(controller.loading).toBe(false);
    broken = false; await controller.refresh();
    expect(controller.error).toBeNull(); expect(controller.snapshot?.branches).toEqual([branch("main", "local", true)]);
    controller.close();
  });

  test("persistence errors remain visible without claiming a pin was saved", async () => {
    const context: Location = { space: "a", cwd: "/repo", on: null };
    const fake: Exec = async (_program, argv) => argv.includes("rev-parse") ? ok("/repo\n") : ok("refs/heads/main\0\0*\n");
    const controller = new BranchesController({ exec: fake, location: () => context, loadPins: () => [], savePins: () => { throw new Error("Storage is full"); } });
    await controller.refresh(); controller.togglePin(branch("main"));
    expect(controller.error).toBe("Storage is full"); expect(controller.pins.size).toBe(0);
    controller.close();
  });
});

describe("Branches focus context", () => {
  const spaces = [
    { id: "a", active: true, folder: "/startup", machine: null, tabs: [{ id: "ta" }] },
    { id: "b", active: false, folder: "/startup", machine: "remote", tabs: [{ id: "tb" }] },
  ];
  const panes = [{ pane: "pa", tab: "ta", cwd: "/live/a" }, { pane: "pb", tab: "tb", cwd: "/live/b" }];
  test("live focus wins active-space lag without borrowing a foreign pane's cwd", () => {
    expect(resolveContext(spaces, panes, { space: "b", tab: "tb", pane: "pb", cwd: "/fallback" }))
      .toEqual({ space: "b", cwd: "/live/b", on: "remote" });
    expect(resolveContext(spaces, panes, { space: "b", tab: "tb", pane: "pa", cwd: "/fallback" }))
      .toEqual({ space: "b", cwd: "/fallback", on: "remote" });
    expect(resolveContext(spaces, panes, { space: "b", tab: "unknown", pane: "pb", cwd: null }))
      .toEqual({ space: "b", cwd: "/startup", on: "remote" });
  });
  test("missing focus falls back coherently and standalone terminals route their own machine", () => {
    expect(resolveContext(spaces, panes, null)).toEqual({ space: "a", cwd: "/startup", on: null });
    expect(resolveContext(spaces, panes, { space: "gone", tab: "tb", pane: "pb", cwd: "/stale" }))
      .toEqual({ space: "a", cwd: "/startup", on: null });
    expect(resolveContext([], panes, null)).toEqual({ space: null, cwd: null, on: null });
    expect(resolveContext(spaces, panes, { space: "b", tab: "tb", pane: null, terminal: "other/session", cwd: "/standalone" }))
      .toEqual({ space: "b", cwd: "/standalone", on: "other" });
  });
});

test("Branches native rows support interaction, scrolling, and pin storage outside layout callbacks", async () => {
  const context = repo();
  const script = `
    import { mock } from "bun:test";
    import assert from "node:assert/strict";
    const cwd = ${JSON.stringify(context.cwd)};
    const values = new Map(), signals = new Map(), pending = [], overlays = [], closedOverlays = [], ticks = [];
    let missing, readError = null, writeError = null, drawn = [], controls = new Map();
    let nodes = [], lazy = [], inLayout = false, focusedHandle, folder = cwd, viewProps = {};
    // Native gpui::Role names used by these controls, not browser ARIA spellings.
    const nativeRoles = { alert: true, button: true, dialog: true, group: true, menu: true, menu_item: true, tree: true, tree_item: true };
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
      getItem(key) {
        if (readError) throw readError;
        return values.has(key) ? values.get(key) : missing;
      },
      setItem(key, value) {
        if (writeError) throw writeError;
        values.set(key, value);
      },
    } });
    const element = () => {
      const data = { children: [], handlers: {}, styles: {} };
      const node = new Proxy({}, { get: (_, key) => {
        if (key === "then") return undefined;
        if (key === "data") return data;
        if (key === "when") return (condition, apply) => { if (condition) apply(node); return node; };
        if (key === "child") return (value) => { data.children.push(value); return node; };
        if (key === "children") return (values) => { data.children.push(...values); return node; };
        if (key === "id") return (value) => { data.id = value; return node; };
        if (key === "accessibility_label") return (value) => { data.label = value; return node; };
        if (key === "role") return (value) => {
          assert(Object.hasOwn(nativeRoles, value), "unknown native accessibility role: " + value);
          data.styles.role = [value]; return node;
        };
        if (String(key).startsWith("on_")) return (...args) => {
          assert.equal(inLayout, false, "native lazy rows cannot register " + String(key) + " during layout");
          const name = key === "on_mouse_down" ? key + ":" + args[0] : key;
          data.handlers[name] = args.at(-1); return node;
        };
        return (...args) => { data.styles[key] = args; return node; };
      } });
      return node;
    };
    const layout = () => {
      inLayout = true;
      try { for (const render of lazy.splice(0)) render(); }
      finally { inLayout = false; }
    };
    const virtualList = (_id, count, _height, _key, render) => {
      const node = element();
      lazy.push(() => node.children(render({ start: 0, end: count })));
      return node;
    };
    virtualList("native-contract", 1, 24, () => "row", () => [element().on_click(() => {})]);
    assert.throws(layout, /native lazy rows cannot register on_click during layout/);
    mock.module("gpui-kit", () => ({ View: class {}, div: element, svg: element }));
    mock.module("gpui-base", () => ({
      h_flex: element, v_flex: element,
      InputState: { new: element }, Input: { new: element },
      TextareaState: { new: element }, Textarea: { new: element }, Checkbox: { new: element },
      VirtualListScrollHandle: { new: () => assert.fail("interactive trees must not allocate native virtual scroll handles") },
      Scrollbar: { vertical: () => assert.fail("manual rows have no native vertical scrollbar"),
        horizontal: () => assert.fail("branch trees must not allocate a horizontal scrollbar") },
      v_virtual_list: virtualList,
    }));
    mock.module("herdr", () => ({
      spaces: () => [{ id: "first", active: true, folder, machine: null, tabs: [] }],
      panes: () => [], focused: () => null, props: () => viewProps,
      theme: () => new Proxy({}, { get: () => "#112233" }),
      settings: () => ({ zoom: 1 }),
      shared: (key) => signals.get(key), setShared: (key, value) => signals.set(key, value),
      openOverlay: (overlay) => overlays.push(overlay), closeOverlay: (overlay) => closedOverlays.push(overlay),
      exec: async (program, argv, options) => {
        assert.equal(program, "git"); assert.equal(options.on, null);
        const result = Bun.spawnSync([program, ...argv], { cwd: options.cwd, env: ${JSON.stringify(env)} });
        return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
      },
    }));
    const cx = {
      focus_handle: () => {
        const handle = { is_focused: () => focusedHandle === handle, focus() { focusedHandle = handle; } };
        return handle;
      },
      notify() {}, stop_propagation() {},
      spawn(callback) { pending.push(callback(cx)); },
      timer: { after: () => ({ cancel() {} }), every: (delay, callback) => {
        ticks.push(callback); return { cancel() {} };
      } },
    };
    const settle = async () => { while (pending.length) await Promise.all(pending.splice(0)); };
    // Platform-only imports must load after native mocks register; static imports run before mock registration.
    const { default: BranchesView } = await import(${JSON.stringify(new URL("../herdr/mods/t3-branches/main.js", import.meta.url).href)});
    const mount = async () => {
      const view = new BranchesView(); view.init({}, cx); await settle();
      assert.equal(view.part.controller.snapshot.state, "ready");
      assert.equal(view.part.controller.error, null);
      return view;
    };
    const render = (view) => {
      drawn = []; controls = new Map(); nodes = [];
      const root = view.render(cx);
      layout();
      const visit = (value) => {
        if (typeof value === "string") { drawn.push(value); return; }
        if (!value?.data) return;
        const data = value.data; nodes.push(data);
        if (data.label && data.handlers.on_click) controls.set(data.label, data.handlers.on_click);
        for (const child of data.children) visit(child);
      };
      visit(root);
    };
    const assertHealthy = (view, pinned = false) => {
      render(view);
      assert(drawn.includes("main"), "actual branch rows must render");
      assert(drawn.includes("1 branches"));
      assert.equal(drawn.some(text => text.includes("Couldn't load pinned branches")), false);
      assert.equal(drawn.some(text => text.includes("Couldn't save pinned branches")), false);
      assert.equal(view.part.storageError, null);
      assert(controls.has((pinned ? "Unpin" : "Pin") + " local branch main"));
    };
    const pin = (view) => {
      render(view);
      const click = controls.get("Pin local branch main");
      assert(click, "the rendered branch must expose its Pin control");
      click({}, cx);
    };
    const key = "pins.v1:" + JSON.stringify([null, cwd]);
    const saved = JSON.stringify(["refs/heads/main"]);
    for (const absent of [undefined, null]) {
      missing = absent; values.clear();
      const view = await mount();
      assertHealthy(view);
      assert.equal(view.part.controller.pins.size, 0);
      assert.equal(values.size, 0, "missing preferences must not write storage");
      pin(view);
      assert.deepEqual([...values], [[key, saved]], "pins retain their machine/repository storage key");
      assertHealthy(view, true);
      view.close();
      const reopened = await mount();
      assert.deepEqual([...reopened.part.controller.pins], ["refs/heads/main"]);
      assertHealthy(reopened, true);
      reopened.close();
    }
    for (const corrupt of ["{", "", "undefined", "null", "{}", '["refs/heads/main",1]']) {
      values.set(key, corrupt);
      const view = await mount();
      render(view);
      assert(drawn.includes("main"), "corrupt preferences must not hide branches");
      assert(drawn.some(text => text.startsWith("Couldn't load pinned branches:")));
      assert.equal(view.part.controller.pins.size, 0);
      assert.equal(values.get(key), corrupt, "loading must not silently replace corrupt preferences");
      pin(view);
      assert.equal(values.get(key), saved);
      assertHealthy(view, true);
      view.close();
      const reopened = await mount();
      assertHealthy(reopened, true);
      reopened.close();
    }
    values.clear(); readError = new Error("Storage unavailable");
    const unreadable = await mount();
    render(unreadable);
    assert(drawn.some(text => text.includes("Couldn't load pinned branches: Storage unavailable")));
    readError = null;
    pin(unreadable);
    assertHealthy(unreadable, true);
    unreadable.close();
    values.clear();
    const unwritable = await mount();
    writeError = new Error("Storage is full");
    pin(unwritable); render(unwritable);
    assert(drawn.some(text => text.includes("Couldn't save pinned branches: Storage is full")));
    assert.equal(unwritable.part.controller.error, "Storage is full");
    assert.equal(unwritable.part.controller.pins.size, 0);
    assert.equal(values.size, 0);
    writeError = null; unwritable.close();
    console.log("Branches native pin storage passed");
    values.clear();
    const fixtureGit = (args, input) => {
      const result = Bun.spawnSync(["git", ...args], { cwd, env: ${JSON.stringify(env)},
        ...(input === undefined ? {} : { stdin: new TextEncoder().encode(input) }) });
      assert.equal(result.exitCode, 0, result.stderr.toString());
      return result.stdout.toString().trim();
    };
    const tip = fixtureGit(["rev-parse", "HEAD"]);
    fixtureGit(["update-ref", "refs/remotes/origin/main", tip]);
    fixtureGit(["update-ref", "refs/remotes/origin/team/topic", tip]);
    fixtureGit(["update-ref", "refs/remotes/upstream/main", tip]);
    const remoteView = await mount(), remotePart = remoteView.part;
    const remoteFolder = (name) => remotePart.visibleRows.find(row =>
      row.name === name && row.depth === 1 && row.children && row.id.includes('"remote"'));
    const origin = remoteFolder("origin"), upstream = remoteFolder("upstream");
    assert(origin && upstream, "remote origins must be visible beneath the expanded Remote root");
    assert(remotePart.collapsed.has(origin.id) && remotePart.collapsed.has(upstream.id));
    assert(!remotePart.visibleRows.some(row => row.branch?.kind === "remote"), "new origins start collapsed");
    assert(remotePart.visibleRows.some(row => row.branch?.name === "main" && row.branch.kind === "local"),
      "local branches remain expanded");
    remotePart.activate(origin);
    assert(remotePart.visibleRows.some(row => row.branch?.name === "origin/team/topic"),
      "expanding an origin exposes nested folders with their existing defaults");
    remotePart.activate(upstream);
    remotePart.activate(upstream);
    await remotePart.controller.refresh();
    assert(!remotePart.collapsed.has(origin.id) && remotePart.collapsed.has(upstream.id),
      "refresh preserves both expanded and collapsed choices");
    fixtureGit(["update-ref", "refs/remotes/new-origin/main", tip]);
    await remotePart.controller.refresh();
    const newOrigin = remoteFolder("new-origin");
    assert(newOrigin && remotePart.collapsed.has(newOrigin.id), "origins discovered on refresh start collapsed");
    assert(!remotePart.collapsed.has(origin.id), "new origins do not reset existing choices");
    fixtureGit(["update-ref", "-d", "refs/remotes/origin/main"]);
    fixtureGit(["update-ref", "-d", "refs/remotes/origin/team/topic"]);
    await remotePart.controller.refresh();
    fixtureGit(["update-ref", "refs/remotes/origin/main", tip]);
    await remotePart.controller.refresh();
    assert(!remotePart.collapsed.has(remoteFolder("origin").id), "returning origins retain their earlier choice");
    remoteView.close();
    for (const ref of ["origin/main", "upstream/main", "new-origin/main"])
      fixtureGit(["update-ref", "-d", "refs/remotes/" + ref]);
    const longName = "a-very-long-branch-name-that-must-not-push-controls-out-of-view";
    const deepName = "one/two/three/four/five/six/seven/eight/" + longName;
    fixtureGit(["update-ref", "refs/heads/" + deepName, tip]);
    values.set(key, saved);
    const narrowView = await mount(), narrowPart = narrowView.part;
    render(narrowView);
    const narrowList = nodes.find(node => node.id === narrowPart.id + "-tree-y");
    narrowList.handlers.on_size_change({ width: 180, height: 600 }, cx);
    render(narrowView);
    const assertBoundedRow = (label, name, depth, current, pinned) => {
      const row = nodes.find(node => node.styles.role?.[0] === "tree_item" && node.label === label);
      assert(row, "expected rendered row " + label);
      const content = row.children[0].data;
      assert("flex_1" in content.styles && content.styles.min_w?.[0] === 0 && "overflow_hidden" in content.styles);
      const indent = content.children[0].data;
      assert.equal(indent.styles.w[0], depth * 27.2);
      assert.equal(indent.styles.min_w[0], 0);
      assert.equal(indent.styles.flex_shrink[0], 1, "deep indentation must yield available space");
      const text = content.children.find(child => child?.data?.children.includes(name))?.data;
      assert(text && "truncate" in text.styles && text.styles.min_w?.[0] === 0 && "flex_1" in text.styles);
      const pin = row.children.find(child => child?.data?.label === (pinned ? "Unpin" : "Pin") + " local branch " + (current ? "main" : deepName))?.data;
      assert(pin && "flex_none" in pin.styles, "pin control must remain outside the clipped name area");
      if (current) {
        const marker = row.children.find(child => child?.data?.children.includes("Current"))?.data;
        assert(marker && "flex_none" in marker.styles, "Current must remain outside the clipped name area");
      }
    };
    const currentRow = narrowPart.visibleRows.find(row => row.branch?.name === "main" && row.id.includes("pinned/local"));
    const deepRow = narrowPart.visibleRows.find(row => row.branch?.name === deepName);
    assert(currentRow && deepRow && deepRow.depth > 8);
    assertBoundedRow("local branch main, current branch, pinned", "main", currentRow.depth, true, true);
    assertBoundedRow("local branch " + deepName, longName, deepRow.depth, false, false);
    narrowView.close();
    fixtureGit(["update-ref", "-d", "refs/heads/" + deepName]);
    values.clear();
    const names = [...Array.from({ length: 140 }, (_, i) => "branch-" + String(i).padStart(3, "0")), "feature/nested/topic"];
    fixtureGit(["update-ref", "--stdin"], names.map(name => "create refs/heads/" + name + " " + tip).join("\\n") + "\\n");
    const view = await mount(), part = view.part, listId = part.id + "-tree-y";
    const list = () => nodes.find(node => node.id === listId);
    const keyDown = (key, modifiers = {}) => {
      const tree = nodes.find(node => node.styles.role?.[0] === "tree");
      assert(tree, "the rendered tree must receive keyboard events");
      tree.handlers.on_key_down({ key, modifiers }, cx); render(view);
    };
    const click = (label) => {
      const handler = controls.get(label); assert(handler, "missing rendered control: " + label);
      handler({}, cx); render(view);
    };
    render(view);
    assert(drawn.includes("142 branches"));
    assert(drawn.includes("topic"), "loaded nested branch names must render");
    assert(!drawn.includes("branch-139"), "unmeasured rendering must remain bounded");
    assert(nodes.filter(node => node.styles.role?.[0] === "tree_item").length <= Math.ceil(2000 / 24));
    assert(!nodes.some(node => node.id === part.id + "-tree-x" || "overflow_x_scroll" in node.styles),
      "the branch tree must not require horizontal scrolling");
    const treeViewport = nodes.find(node => node.styles.role?.[0] === "tree");
    assert("size_full" in treeViewport.styles && treeViewport.styles.min_w?.[0] === 0);
    assert("size_full" in list().styles, "the list must use the full available tree viewport");
    part.handles.tree.focus();
    keyDown("end"); keyDown("up"); keyDown("up");
    assert.equal(part.visibleRows[part.treeAt].branch.name, "branch-139");
    assert(!drawn.includes("branch-139"), "keyboard reveal must wait for native viewport measurement");
    assert.equal(part.treeReveal, part.treeAt);
    list().handlers.on_size_change({ width: 300, height: 144 }, cx);
    render(view);
    assert.equal(part.listHeight[listId], 144);
    assert(drawn.includes("branch-139"), "measurement must reveal the offscreen keyboard target");
    assert.equal(part.treeReveal, null, "reveal must be consumed after a measured render");
    assert.equal(nodes.filter(node => node.styles.role?.[0] === "tree_item").length, 6);
    assert(nodes.some(node => node.label === "local branch branch-139"
      && node.children.some(child => child?.data?.styles.border?.[0] === 2)), "keyboard focus must remain visible");
    keyDown("space");
    assert(part.controller.pins.has("refs/heads/branch-139"));
    assert.equal(part.visibleRows[part.treeAt].branch.name, "branch-139");
    assert(controls.has("Unpin local branch branch-139"));
    keyDown("space");
    assert(!part.controller.pins.has("refs/heads/branch-139"));
    list().handlers.on_scroll_wheel({ delta: { x: 0, y: 10000 } }, cx);
    render(view);
    assert.equal(part.scrollTop[listId], 0);
    assert(drawn.includes("branch-000"));
    assert(!drawn.includes("branch-139"), "wheel scrolling must expose rows away from keyboard focus");
    render(view);
    assert.equal(part.scrollTop[listId], 0, "ordinary renders must not snap back to the focused branch");
    assert.equal(part.visibleRows[part.treeAt].branch.name, "branch-139");
    const wheel = list().handlers.on_scroll_wheel;
    wheel({ delta: { x: 0, y: -24 } }, cx); wheel({ delta: { x: 0, y: -24 } }, cx);
    render(view);
    assert.equal(part.scrollTop[listId], 48, "wheel bursts must accumulate before the next render");
    keyDown("home");
    const expandedCount = part.visibleRows.length;
    click("Collapse folder feature");
    assert.equal(part.visibleRows.length, expandedCount - 2);
    assert(!drawn.includes("topic"));
    keyDown("right");
    assert.equal(part.visibleRows.length, expandedCount);
    assert(drawn.includes("topic"));
    click("local branch feature/nested/topic");
    click("Pin local branch feature/nested/topic");
    assert(part.controller.pins.has("refs/heads/feature/nested/topic"));
    assert.equal(part.visibleRows[part.treeAt].branch.name, "feature/nested/topic");
    assert(controls.has("Unpin local branch feature/nested/topic"));
    keyDown("home"); keyDown("down"); keyDown("down"); keyDown("down"); keyDown("down");
    assert.equal(part.visibleRows[part.treeAt].branch.name, "feature/nested/topic");
    assert(part.visibleRows[part.treeAt].id.includes("pinned/local"));
    keyDown("space");
    assert(!part.controller.pins.has("refs/heads/feature/nested/topic"));
    assert.equal(part.visibleRows[part.treeAt].branch.name, "feature/nested/topic",
      "unpinning a pinned duplicate must preserve the same branch in the local tree");
    const pinControl = nodes.find(node => node.label === "Pin local branch feature/nested/topic");
    assert.equal(pinControl.styles.tab_index?.[0], 0, "the focused branch's Pin control must remain tabbable");
    pinControl.styles.track_focus[0].focus();
    pinControl.handlers.on_key_down({ key: "enter" }, cx); render(view);
    assert(part.controller.pins.has("refs/heads/feature/nested/topic"), "the Pin control must support keyboard activation");
    assert(part.handles.tree.is_focused(), "pinning must return keyboard focus to the tree");
    keyDown("space");
    const target = nodes.find(node => node.styles.role?.[0] === "tree_item"
      && node.label?.startsWith("local branch feature/nested/topic"));
    assert(target?.handlers["on_mouse_down:right"], "visible branch rows must expose secondary click");
    target.handlers["on_mouse_down:right"]({}, cx); await settle(); render(view);
    assert.equal(overlays.at(-1).props.ctx.branch.ref, "refs/heads/feature/nested/topic");
    assert.equal(overlays.at(-1).props.role, "menu");
    keyDown("f10", { shift: true }); await settle(); render(view);
    assert.equal(overlays.at(-1).props.ctx.branch.ref, "refs/heads/feature/nested/topic");
    assert.equal(overlays.length, 2, "both pointer and keyboard branch actions must remain available");
    keyDown("end"); keyDown("up"); keyDown("enter");
    assert.equal(part.selectedRef, "refs/heads/main");
    assert.equal(fixtureGit(["symbolic-ref", "--short", "HEAD"]), "main", "selection must not change Git checkout");
    const ownerTick = ticks.at(-1);
    viewProps = { ...overlays.at(-1).props, overlay: "branch-actions-test" };
    const menuView = new BranchesView(); menuView.init({}, cx); render(menuView);
    const menuItems = nodes.filter(node => node.styles.role?.[0] === "menu_item");
    assert(menuItems.some(node => node.label === "Copy branch name"), "branch action labels must render with native menu item roles");
    const menuRoot = nodes.find(node => node.styles.role?.[0] === "menu");
    assert("h_full" in menuRoot.styles && menuRoot.styles.max_h?.[0] === 520,
      "the popup menu must fill its bounded allocated height");
    const menuList = menuRoot.children.find(child => child?.data && "overflow_y_scrollbar" in child.data.styles)?.data;
    assert(menuList && "flex_1" in menuList.styles && menuList.styles.min_h?.[0] === 0,
      "the scrolling list must receive the remaining bounded popup height");
    assert(menuList.children.length === menuItems.length && menuItems.length > 0,
      "the scrolling viewport must contain the rendered action items");
    assert(menuItems.every(item => item.styles.h?.[0] === 30 && "flex_none" in item.styles),
      "action rows retain nonzero height inside the scrolling viewport");
    menuRoot.handlers.on_key_down({ key: "down" }, cx);
    assert.equal(menuView.part.at, 1, "rendered branch actions must retain keyboard navigation");
    menuRoot.handlers.on_key_down({ key: "escape" }, cx);
    assert.deepEqual(closedOverlays, ["branch-actions-test"], "Escape must close the rendered branch menu");
    menuView.close(); viewProps = {};
    part.handles.tree.focus(); render(view);
    folder = null; ownerTick(cx); render(view);
    assert.equal(part.treeReveal, null);
    assert.equal(part.scrollTop[listId], 0, "context transitions must reset the previous repository's scroll position");
    assert.equal(part.selectedRef, null);
    assert(drawn.includes("No folder selected. Focus a terminal in a repository, then refresh."));
    view.close();
    console.log("Branches native row interaction and scrolling passed");
  `;
  // Native module mocks stay in this child process and cannot contaminate other suites.
  const child = Bun.spawn([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
  expect(stdout).toContain("Branches native pin storage passed");
  expect(stdout).toContain("Branches native row interaction and scrolling passed");
}, 30_000);
