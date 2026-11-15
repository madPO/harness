import { describe, expect, test } from "bun:test";
import { resolveContext } from "../herdr/mods/t3-files/context.js";

const space = (id: string, active = false, machine: string | null = null) => ({ id, active, machine, folder: "/startup", tabs: [{ id: `${id}-tab` }] });
const focus = (id: string, cwd: string | null = null) => ({ space: id, tab: `${id}-tab`, pane: `${id}-pane`, cwd, terminal: "term" });

describe("Files context resolution", () => {
  test("live focus beats lagging active snapshots and validates pane ownership", () => {
    const all = [space("a", true), space("b", false, "remote")];
    expect(resolveContext(all, [{ pane: "b-pane", tab: "b-tab", cwd: "/live-b" }], focus("b")))
      .toEqual({ space: "b", cwd: "/live-b", on: "remote" });
    expect(resolveContext(all, [{ pane: "b-pane", tab: "a-tab", cwd: "/wrong" }], focus("b", "/focus-b")))
      .toEqual({ space: "b", cwd: "/focus-b", on: "remote" });
    expect(resolveContext(all, [{ pane: "b-pane", tab: "missing", cwd: "/wrong" }], { ...focus("b"), tab: "missing" }).cwd).toBe("/startup");
    expect(resolveContext(all, [], focus("gone", "/stale"))).toEqual({ space: "a", cwd: "/startup", on: null });
  });

  test("missing and mod-focused cwd fall back without retaining stale folders", () => {
    expect(resolveContext([space("a", true)], [], focus("a")).cwd).toBe("/startup");
    expect(resolveContext([space("a", true)], [{ pane: "a-pane", tab: "a-tab", cwd: null, mod: "files" }], focus("a")).cwd).toBe("/startup");
    expect(resolveContext([{ ...space("a", true), folder: "" }], [], focus("a", ""))).toEqual({ space: "a", cwd: null, on: null });
    expect(resolveContext([], [], focus("a", "/stale"))).toEqual({ space: null, cwd: null, on: null });
    expect(resolveContext([space("a", true)], [], { ...focus("a", "/live"), pane: null, terminal: "remote/term" }))
      .toEqual({ space: "a", cwd: "/live", on: "remote" });
  });
});

// Each native harness runs in a subprocess. Bun mock.module cannot leak into other suites.
const nativeHarness = String.raw`
import { mock } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const home = mkdtempSync(join(tmpdir(), "herdr-files-"));
const a = join(home, "a"), b = join(home, "b");
mkdirSync(a); mkdirSync(b);
mkdirSync(join(a, "kept"));
writeFileSync(join(a, "a.txt"), "a preview"); writeFileSync(join(b, "b.txt"), "b preview");
let all = [sp("a", true), sp("b", false)], focusedValue = f("a"), paneValues = [], inRender = false;
let writes = 0, releases = 0, notices = 0, after = [], every = [], commands = [], calls = [], errors = [];
let execHook = null, readHook = null;
function sp(id, active, machine = null) { return { id, active, machine, folder: home, tabs: [{ id: id + "-tab" }] }; }
function f(id, cwd = id === "a" ? a : b) { return { space: id, tab: id + "-tab", pane: id + "-pane", cwd, terminal: "term" }; }
function native() { assert.equal(inRender, false, "Native mutation occurred during render"); writes++; }
function element() {
  const data = { children: [], id: null };
  let proxy;
  proxy = new Proxy(data, { get(target, key) {
    if (key === "then") return undefined;
    if (key === "data") return target;
    return (...args) => {
      if (key === "child") target.children.push(args[0]);
      if (key === "children") target.children.push(...args[0]);
      if (key === "id") target.id = args[0];
      if (key === "when" && args[0]) args[1](proxy);
      return proxy;
    };
  } });
  return proxy;
}
function text(node) {
  if (typeof node === "string") return node;
  return node?.data ? [node.data.id, ...node.data.children.map(text)].join(" ") : "";
}
const storage = new Map();
globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) };
const input = { valueText: "", handlers: {}, value() { return this.valueText; }, on(k, cb) { this.handlers[k] = cb; },
  set_value(v) { native(); this.valueText = v; this.handlers.change?.({}, cx); }, release() { native(); releases++; } };
mock.module("gpui-kit", () => ({ View: class {}, div: element, svg: element, image: element }));
mock.module("gpui-base", () => ({ v_flex: element, h_flex: element, InputState: { new: () => input }, Input: { new: element }, Editor: { new: element },
  EditorState: { new: options => { native(); return { options, release() { native(); releases++; } }; } }, TextView: { markdown: element } }));
const themeValue = new Proxy({}, { get: () => "#888888" });
mock.module("herdr", () => ({
  spaces: () => all, panes: () => paneValues, focused: () => focusedValue,
  nextCommand: () => { const command = Promise.withResolvers(); commands.push(command.resolve); return command.promise; },
  exec: async (program, args = [], options = {}) => {
    calls.push({ program, args, options });
    // A remote machine uses the same disposable filesystem in this headless harness.
    const result = Bun.spawnSync([program, ...args], { cwd: options.cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
    const value = { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
    return execHook ? await execHook(program, args, options, value) : value;
  },
  readTextFile: async (path, options) => { const value = readFileSync(path, "utf8"); return readHook ? await readHook(path, options, value) : value; },
  theme: () => themeValue, settings: () => ({ zoom: 1, font_family: "monospace" }), shared: () => null,
  setShared: native, appHome: () => home, window: () => ({ active: true, platform: "linux" }),
  layout: () => ({ children: [{ id: "panel" }, { id: "panel-body", active: "files", children: [{ id: "files" }] }] }),
  run: native, agents: () => [], notify: native,
}));
function timer(list, callback) { const item = { callback, canceled: false, cancel() { this.canceled = true; } }; list.push(item); return item; }
const cx = {
  focus_handle: () => ({ focus: native, is_focused: () => false }),
  notify() { native(); notices++; }, stop_propagation() {}, sleep: async () => {},
  spawn(callback) { Promise.resolve(callback(cx)).catch(error => errors.push(error)); },
  timer: { after: (_ms, cb) => timer(after, cb), every: (_ms, cb) => timer(every, cb) },
};
async function settle() { for (let n = 0; n < 100; n++) await Promise.resolve(); if (errors.length) throw errors.shift(); }
async function timers() { const pending = after; after = []; for (const item of pending) if (!item.canceled) item.callback(cx); await settle(); }
function render() { inRender = true; try { return text(view.render(cx)); } finally { inRender = false; } }
function activate(id, cwd) { focusedValue = f(id, cwd); }
function deferred() { return Promise.withResolvers(); }
// Native mocks must register before loading this mod; static imports would load real host bindings first.
const { default: Files } = await import(MAIN_URL);
const view = new Files(); view.init({}, cx);
try {
SCENARIO
} finally { await view.close(); rmSync(home, { recursive: true, force: true }); }
`;

async function nativeCase(scenario: string) {
  const source = nativeHarness.replace("MAIN_URL", JSON.stringify(new URL("../herdr/mods/t3-files/main.js", import.meta.url).href))
    .replace("SCENARIO", scenario);
  const process = Bun.spawn([Bun.which("bun")!, "--eval", source], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
  expect({ code, stdout, stderr }).toEqual({ code: 0, stdout: "", stderr: "" });
}

describe("Files live native boundary", () => {
  test("same startup folders follow live directories despite lagging active space snapshots", async () => {
    await nativeCase(String.raw`
      assert.match(render(), /Loading files/); await timers();
      const first = view.current(); assert.equal(first.root, a); assert.match(render(), /a\.txt/);
      view.open(first, "a.txt", cx); await settle(); assert.equal(first.view.text, "a preview");
      activate("b"); const before = writes;
      assert.match(render(), /Loading files/); assert.equal(writes, before);
      assert.equal(view.current(), null); assert.equal(after.length, 1); render(); assert.equal(after.length, 1);
      await timers(); const second = view.current(); assert.equal(second.id, "b"); assert.equal(second.root, b);
      assert.match(render(), /b\.txt/); assert.doesNotMatch(render(), /a\.txt/);
      view.open(second, "b.txt", cx); await settle(); assert.equal(second.view.text, "b preview");
      activate("a"); render(); await timers(); assert.equal(view.current(), first); assert.equal(first.file, "a.txt");
    `);
  });

  test("retained searches restore outside render and clear menus on every context switch", async () => {
    await nativeCase(String.raw`
      render(); await timers(); const first = view.current();
      view.find(first, "a", cx); await settle(); input.set_value("a");
      first.expanded.add("kept"); first.focus = "a.txt";
      view.menu = { path: "a.txt" }; view.menuFor = "a.txt";
      activate("b"); const before = writes; render(); assert.equal(writes, before); await timers();
      assert.equal(input.value(), ""); assert.equal(view.menu, null); assert.equal(view.menuFor, null);
      view.find(view.current(), "b", cx); await settle(); input.set_value("b");
      activate("a"); const next = writes; render(); assert.equal(writes, next); await timers();
      assert.equal(view.current(), first); assert.equal(first.query, "a"); assert.equal(input.value(), "a");
      assert.equal(first.focus, "a.txt"); assert.equal(first.expanded.has("kept"), true);
    `);
  });

  test("cwd and machine changes invalidate resources without native mutation during render", async () => {
    await nativeCase(String.raw`
      render(); await timers(); const first = view.current(); view.open(first, "a.txt", cx); await settle();
      const released = releases; activate("a", b); const before = writes;
      assert.match(render(), /Loading files/); assert.equal(writes, before); await timers();
      assert.notEqual(view.current(), first); assert.equal(view.current().root, b); assert.equal(releases, released + 1);
      const local = view.current(); all[0].machine = "remote";
      const another = writes; render(); assert.equal(writes, another); await timers();
      assert.notEqual(view.current(), local); assert.equal(view.current().root, b); assert.equal(view.current().on, "remote");
      assert.equal(view.current().file, null);
    `);
  });

  test("identical cwd and machine still retain distinct per-space selections and searches", async () => {
    await nativeCase(String.raw`
      render(); await timers(); const first = view.current();
      view.open(first, "a.txt", cx); view.find(first, "a", cx); await settle();
      activate("b", a); render(); await timers(); const second = view.current();
      assert.notEqual(second, first); assert.equal(second.root, first.root); assert.equal(second.on, first.on);
      assert.equal(second.file, null); assert.equal(second.query, "");
      view.find(second, "kept", cx); await settle();
      activate("a"); render(); await timers();
      assert.equal(view.current(), first); assert.equal(first.file, "a.txt"); assert.equal(first.query, "a");
      assert.equal(second.query, "kept");
    `);
  });

  test("visible-page polling remains available without duplicate context loads", async () => {
    await nativeCase(String.raw`
      render(); await timers(); const st = view.current(), before = calls.length;
      render(); render(); assert.equal(after.length, 0); assert.equal(calls.length, before);
      st.refreshed = 0; every[0].callback(cx); await settle();
      assert.ok(calls.length > before); assert.equal(view.current(), st);
    `);
  });

  test("cache eviction releases editors after render and restores retained browsing state", async () => {
    await nativeCase(String.raw`
      all.push(sp("c", false), sp("d", false));
      render(); await timers(); const first = view.current();
      view.open(first, "a.txt", cx); view.find(first, "a", cx); await settle();
      first.expanded.add("kept");
      for (const id of ["b", "c", "d"]) {
        activate(id); const before = writes; render(); assert.equal(writes, before); await timers();
      }
      assert.notEqual(view.states.get("a"), first); assert.equal(first.view, null);
      assert.ok(releases > 0); const retained = view.states.get("a");
      assert.equal(retained.file, "a.txt"); assert.equal(retained.query, "a"); assert.equal(retained.expanded.has("kept"), true);
      activate("a"); render(); await timers();
      assert.equal(view.current().view.text, "a preview"); assert.equal(input.value(), "a");
    `);
  });

  test("late listings, previews, searches and errors cannot publish across context transitions", async () => {
    await nativeCase(String.raw`
      const listing = deferred(), reading = deferred(), searching = deferred();
      execHook = async (program, args, options, value) => {
        if (args[2] === "files" && args[3] === a) { await listing.promise; return { code: 1, stdout: "", stderr: "old failure" }; }
        if (options.cwd === a && program === "sh" && args[1]?.startsWith("find .")) await searching.promise;
        return value;
      };
      readHook = async (path, options, value) => { if (path === join(a, "a.txt")) await reading.promise; return value; };
      render(); await timers(); const first = view.current();
      view.open(first, "a.txt", cx); view.find(first, "a", cx); await settle();
      activate("b"); render(); await timers(); const second = view.current();
      view.open(second, "b.txt", cx); await settle(); const before = writes;
      listing.resolve(); reading.resolve(); searching.resolve(); await settle();
      assert.equal(writes, before); assert.equal(second.view.text, "b preview"); assert.equal(second.error, null);
      assert.equal(first.view.loading, true); assert.equal(first.results, null); assert.equal(first.error, undefined);
      assert.doesNotMatch(render(), /a\.txt|old failure/);
    `);
  });

  test("empty or absent context clears old content and notifies even without successful reads", async () => {
    await nativeCase(String.raw`
      render(); await timers(); view.open(view.current(), "a.txt", cx); await settle();
      all[1].folder = ""; focusedValue = f("b", ""); const before = notices;
      assert.doesNotMatch(render(), /a\.txt/); await timers(); assert.ok(notices > before);
      assert.equal(view.current().root, null); assert.match(render(), /no folder/);
      focusedValue = null; all = []; const next = notices; assert.doesNotMatch(render(), /a\.txt/);
      await timers(); assert.equal(view.current(), null); assert.equal(view.awake, null); assert.ok(notices > next);
    `);
  });

  test("commands use current live context and close rejects late native callbacks", async () => {
    await nativeCase(String.raw`
      render(); await timers(); activate("b"); commands.shift()("open:b.txt"); await settle();
      const second = view.current(); assert.equal(second.id, "b"); assert.equal(second.view.text, "b preview");
      const pending = deferred(); readHook = async (_path, _options, value) => { await pending.promise; return value; };
      view.open(second, "b.txt", cx); await settle(); activate("a"); render();
      await view.close(); const before = writes; pending.resolve(); await settle(); await timers();
      for (const item of every) if (!item.canceled) item.callback(cx);
      assert.equal(writes, before); assert.equal(view.states.size, 0);
    `);
  });
});
