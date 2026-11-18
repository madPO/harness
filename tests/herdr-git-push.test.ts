import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeAction, prepareForcePush } from "../herdr/mods/git-graph/execute.js";
import { dialogFor, initialValues } from "../herdr/mods/git-graph/git.js";

const roots: string[] = [];
const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };
function dir() { const root = mkdtempSync(join(tmpdir(), "graph-push-")); roots.push(root); return root; }
function git(cwd: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", ...args], { cwd, env });
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}
function must(cwd: string, ...args: string[]) { const result = git(cwd, ...args); if (result.code) throw new Error(result.stderr); return result.stdout.trim(); }
const exec = async (_program: string, args: string[], options: { cwd: string }) => git(options.cwd, ...args);
function commit(cwd: string, file: string) { writeFileSync(join(cwd, file), file); must(cwd, "add", file); must(cwd, "commit", "-m", file); return must(cwd, "rev-parse", "HEAD"); }
function fixture() {
  const root = dir(), remote = dir(), other = dir();
  must(root, "init", "-b", "main"); must(root, "config", "user.name", "Test"); must(root, "config", "user.email", "test@example.invalid");
  must(root, "config", "commit.gpgSign", "false"); must(root, "config", "core.hooksPath", "/dev/null");
  const base = commit(root, "base"); must(remote, "init", "--bare"); must(other, "init", "--bare");
  must(root, "remote", "add", "origin", remote); must(root, "remote", "add", "other", other);
  must(root, "push", "origin", "HEAD:refs/heads/main");
  return { root, remote, other, base };
}
function ctx(root: string) { return { root, on: null, current: must(root, "branch", "--show-current"), head: must(root, "rev-parse", "HEAD"), remotes: ["origin", "other"] }; }
const action = { type: "push", name: "main" };
const values = { remote: "origin", upstream: true, force: false };
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("Git graph push", () => {
  test("dialog defaults to normal push with remote and upstream choices", () => {
    const f = fixture(), context = ctx(f.root), initial = initialValues(action, context);
    expect(initial.force).toBe(false); expect(initial.remote).toBe("origin"); expect(initial.upstream).toBe(true);
    expect(dialogFor(action, context).checks.some((c: { id: string }) => c.id === "force")).toBe(true);
  });
  test("normal push targets one branch and remote despite push configuration", async () => {
    const f = fixture(); must(f.root, "branch", "unrelated"); must(f.root, "tag", "extra");
    must(f.root, "config", "push.followTags", "true"); must(f.root, "config", "push.default", "matching");
    const tip = commit(f.root, "normal"); const result = await executeAction(action, values, ctx(f.root), exec);
    expect(result.ok).toBe(true); expect(must(f.remote, "rev-parse", "refs/heads/main")).toBe(tip);
    expect(git(f.remote, "show-ref", "--verify", "refs/heads/unrelated").code).not.toBe(0);
    expect(git(f.remote, "show-ref", "--verify", "refs/tags/extra").code).not.toBe(0);
    expect(git(f.other, "show-ref", "--verify", "refs/heads/main").code).not.toBe(0);
  });
  test("a selected non-current branch goes only to the selected remote", async () => {
    const f = fixture(); must(f.root, "branch", "topic"); const tip = commit(f.root, "main-only");
    const result = await executeAction({ type: "push", name: "topic" }, { ...values, remote: "other", upstream: false }, ctx(f.root), exec);
    expect(result.ok).toBe(true); expect(must(f.other, "rev-parse", "refs/heads/topic")).toBe(f.base);
    expect(git(f.other, "show-ref", "--verify", "refs/heads/main").code).not.toBe(0);
    expect(must(f.remote, "rev-parse", "refs/heads/main")).toBe(f.base);
    expect(must(f.root, "rev-parse", "HEAD")).toBe(tip);
  });
  test("divergence rejects normal push and explicit lease allows replacement", async () => {
    const f = fixture(); const local = commit(f.root, "local"); must(f.root, "push", "origin", "HEAD:refs/heads/main");
    must(f.root, "reset", "--hard", f.base); const replacement = commit(f.root, "replacement"); const context = ctx(f.root);
    const rejected = await executeAction(action, values, context, exec); expect(rejected.ok).toBe(false);
    expect(must(f.remote, "rev-parse", "refs/heads/main")).toBe(local);
    const lease = await prepareForcePush(action, values, context, exec);
    const result = await executeAction(action, { ...values, force: true, lease }, context, exec);
    expect(result.ok).toBe(true); expect(must(f.remote, "rev-parse", "refs/heads/main")).toBe(replacement);
  });
  test("remote change after confirmation is rejected even after fetch", async () => {
    const f = fixture(); commit(f.root, "local"); const context = ctx(f.root);
    const lease = await prepareForcePush(action, values, context, exec);
    must(f.remote, "update-ref", "refs/heads/main", context.head); must(f.root, "fetch", "origin");
    const result = await executeAction(action, { ...values, force: true, lease }, context, exec);
    expect(result.ok).toBe(false); expect(must(f.remote, "rev-parse", "refs/heads/main")).toBe(context.head);
  });
  test("rejects stale local context and changed remote selection", async () => {
    const f = fixture(); const context = ctx(f.root); const lease = await prepareForcePush(action, values, context, exec);
    await expect(executeAction(action, { ...values, remote: "other", force: true, lease }, context, exec)).rejects.toThrow();
    commit(f.root, "later"); const result = await executeAction(action, { ...values, force: true, lease }, context, exec);
    expect(result.ok).toBe(false); expect(result.stale).toBe(true);
  });
});

test("native graph Push opens an accessible, interactive dialog", async () => {
  const f = fixture();
  const context = ctx(f.root);
  const script = `
    import { mock } from "bun:test";
    import assert from "node:assert/strict";
    const roles = { button: true, radio_button: true, check_box: true };
    const element = () => {
      const data = { children: [], handlers: {} };
      const node = new Proxy({}, { get(_target, key) {
        if (key === "then") return undefined;
        if (key === "data") return data;
        if (key === "role") return value => { assert(Object.hasOwn(roles, value), "Unknown native role: " + value); data.role = value; return node; };
        if (key === "id" || key === "accessibility_label") return value => { data[key] = value; return node; };
        if (key === "when") return (condition, apply) => { if (condition) apply(node); return node; };
        if (key === "child") return child => { data.children.push(child); return node; };
        if (key === "children") return children => { data.children.push(...children); return node; };
        if (String(key).startsWith("on_")) return (...args) => { data.handlers[key] = args.at(-1); return node; };
        return () => node;
      } });
      return node;
    };
    let overlay, closed, focused;
    const pending = [];
    const cx = {
      focus_handle: () => { const handle = { focus() { focused = handle; }, is_focused() { return focused === handle; } }; return handle; },
      notify() {}, stop_propagation() {}, spawn(fn) { pending.push(fn(cx)); },
      timer: { after() {} },
    };
    const settle = async () => { while (pending.length) await Promise.all(pending.splice(0)); };
    const theme = new Proxy({}, { get: () => "#112233" });
    const herdr = {
      props: () => overlay.props, theme: () => theme, shared: () => null, setShared() {},
      openOverlay(value) { overlay = value; }, closeOverlay(value) { closed = value; },
      exec: async (_program, argv, options) => {
        const result = Bun.spawnSync(["git", ...argv], { cwd: options.cwd, env: ${JSON.stringify(env)} });
        return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
      },
      notify() {}, run() {}, spaces() {}, panes() {}, focused() {}, layout() {}, watchFolder() {},
      readTextFile() {}, settings() {}, home() {}, knownAgents() {}, updates() {},
    };
    mock.module("herdr", () => herdr);
    mock.module("gpui-kit", () => ({ div: element, svg: element, image: element, PathBuilder: class {} }));
    mock.module("gpui-base", () => ({ h_flex: element, v_flex: element, InputState: {}, Input: {},
      Scrollbar: {}, v_virtual_list: element, TextView: {} }));
    // Load platform-dependent modules only after registering their native mocks.
    const { Graph } = await import(${JSON.stringify(new URL("../herdr/mods/git-graph/graph.js", import.meta.url).href)});
    const { Dialog } = await import(${JSON.stringify(new URL("../herdr/mods/git-graph/dialog.js", import.meta.url).href)});
    const graph = new Graph();
    Object.assign(graph, { state: "ready", workspace: null, current: "main", head: ${JSON.stringify(context.head)},
      ctx: ${JSON.stringify(context)}, remoteNames: ["origin", "other"], pushHandle: cx.focus_handle() });
    const find = (node, id) => {
      if (!node?.data) return null;
      if (node.data.id === id) return node.data;
      for (const child of node.data.children) { const found = find(child, id); if (found) return found; }
      return null;
    };
    const push = find(graph.header(theme), "graph-push");
    assert.equal(push.role, "button"); assert.equal(push.accessibility_label, "Push current branch");
    push.handlers.on_click({}, cx);
    assert.equal(overlay.props.action.type, "push");
    overlay.props.overlay = "push-overlay";
    const dialog = new Dialog(); dialog.init(cx);
    let tree = dialog.render();
    assert.equal(find(tree, "gd-choice-origin").role, "radio_button");
    assert.equal(find(tree, "gd-check-force").role, "check_box");
    find(tree, "gd-check-force").handlers.on_key_down({ key: "space" }, cx);
    assert.equal(dialog.values.force, true);
    tree = dialog.render(); find(tree, "gd-ok").handlers.on_click({}, cx); await settle();
    assert.equal(dialog.lease.remote, "origin");
    tree = dialog.render();
    assert.equal(find(tree, "gd-ok").accessibility_label, "Force push");
    find(tree, "gd-cancel").handlers.on_click({}, cx);
    assert.equal(dialog.lease, null); assert.equal(closed, undefined);
  `;
  const child = Bun.spawn([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe" });
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
}, 30_000);
