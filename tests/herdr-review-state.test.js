import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateAnalysis } from "../herdr/mods/review-assistant/analysis.js";
import { resolveContext } from "../herdr/mods/review-assistant/context.js";
import { ReviewController } from "../herdr/mods/review-assistant/controller.js";
import { demoReview } from "../herdr/mods/review-assistant/demo.js";

const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };
const directories = [];
const worktree = { kind: "worktree" };
const branch = { kind: "branch", target: "main" };
const location = (cwd, on = null, space = "review") => ({ space, cwd, on });
const policyPath = "quota.js";
const callerPath = "read-quota.js";
const reference = { path: callerPath, symbol: "calculateQuota", line: 2 };
const policy = (expression) => `export function calculateQuota(account) { return ${expression}; }\n`;
const original = policy("account.limit");
const change = (n) => policy(`account.limit - ${n}`);
const write = (root, path, text) => writeFileSync(join(root, path), text);
const editPolicy = (root, n) => write(root, policyPath, change(n));

function directory() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "review-state-")));
  directories.push(root);
  return root;
}

function runCommand(program, args, cwd) {
  const result = Bun.spawnSync([program, ...args], { cwd, env });
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

function git(cwd, ...args) {
  const result = runCommand("git", args, cwd);
  if (result.code !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

function commit(root, message) {
  git(root, "add", "-A");
  git(root, "commit", "-m", message);
  return git(root, "rev-parse", "HEAD");
}

function repo() {
  const root = directory();
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Review Test");
  git(root, "config", "user.email", "review@example.invalid");
  git(root, "config", "commit.gpgSign", "false");
  git(root, "config", "core.hooksPath", "/dev/null");
  write(root, policyPath, original);
  write(root, callerPath, "export function readQuota(account) {\n  return calculateQuota(account);\n}\n");
  const base = commit(root, "Quota policy and caller");
  return { root, base };
}

function topic() {
  const { root, base } = repo();
  git(root, "switch", "-c", "topic");
  editPolicy(root, 1);
  const head = commit(root, "Change quota policy");
  editPolicy(root, 2);
  return { root, base, head };
}

// Simulate remote routing at the exec boundary while every Git command reads real files.
const exec = async (program, args, { cwd }) => runCommand(program, args, cwd);

function review(snapshot, evidence, { title = "Quota review", ids = [] } = {}) {
  return validateAnalysis({
    groups: snapshot.files.map(({ path }, index) => ({
      id: ids[index] ?? `change-${index}`, title, importance: "medium", files: [path],
      description: "Updates quota handling.", keyToReview: "Verify that quotas still enforce the configured limits.",
    })),
    influence: evidence.length ? [{
      name: "Quota consumers", description: "Check that callers still handle the calculated limit.",
      evidenceIds: evidence.map(({ id }) => id),
    }] : [],
  }, snapshot.files, evidence);
}

function state(current, options = {}) {
  const run = mock(options.run ?? ((snapshot, evidence) => review(snapshot, evidence)));
  const prepare = mock(() => options.prepare ? options.prepare(run) : { key: "test/model", run });
  const controller = new ReviewController({
    location: () => current, exec: options.exec ?? exec, scope: options.scope, prepareAnalysis: prepare,
  });
  return { controller, run, prepare, select: (next) => { current = next; } };
}

function pause() {
  const entered = Promise.withResolvers(), resume = Promise.withResolvers();
  return {
    async wait() {
      entered.resolve();
      await resume.promise;
    },
    async whilePending(pending, action) {
      try {
        await Promise.race([entered.promise, pending.then(() => {
          throw new Error("The operation ended before reaching the test gate.");
        })]);
        await action();
      } finally {
        resume.resolve();
        await pending;
      }
    },
  };
}

function expectNoReview(controller, status) {
  expect(controller.model()).toMatchObject({ status, result: null, detail: null, canNavigate: false });
}

function expectTitle(controller, title) {
  expect(controller.model().status).toBe("ready");
  expect(controller.model().result.groups[0].title).toBe(title);
}

afterEach(() => {
  for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Review Assistant state", () => {
  test("prompts for a repository, then reports an empty scope without preparing AI", async () => {
    const { root } = repo();
    const { controller, prepare, select } = state(location(null));
    await controller.probe();
    await controller.refresh();
    expectNoReview(controller, "idle");
    expect(controller.model()).toMatchObject({ canRefresh: false, message: expect.stringMatching(/select a repository/i) });

    select(location(root));
    await controller.probe();
    expectNoReview(controller, "empty");
    expect(controller.model().canRefresh).toBe(true);
    await controller.refresh();
    expectNoReview(controller, "empty");
    expect(prepare).not.toHaveBeenCalled();
  });

  test("probes without AI and sends real diff and unchanged source evidence on explicit refresh", async () => {
    const { root, base } = repo();
    editPolicy(root, 1);
    const { controller, prepare, run } = state(location(root));

    await controller.probe();
    expectNoReview(controller, "idle");
    expect(controller.model().message).toMatch(/select refresh/i);
    expect(prepare).not.toHaveBeenCalled();

    await controller.refresh();
    expect(run).toHaveBeenCalledTimes(1);
    const [[snapshot, evidence]] = run.mock.calls;
    expect(snapshot).toMatchObject({ root, head: base, base, scope: worktree, files: [{ path: policyPath, status: "M" }] });
    expect(snapshot.patch).toContain(`+${change(1).trimEnd()}`);
    expect(evidence).toContainEqual(expect.objectContaining({
      ...reference, text: expect.stringContaining("return calculateQuota(account);"),
    }));
    expectTitle(controller, "Quota review");
    expect(controller.model().result.influence).toMatchObject([{ references: [reference] }]);
    expect([...controller.model().expanded]).toEqual([]);
  });

  test("turns a configuration failure into a retryable error without calling the provider", async () => {
    const { root } = repo();
    editPolicy(root, 1);
    let configured = false;
    const { controller, run } = state(location(root), {
      prepare(run) {
        if (!configured) throw new Error("Configure the analysis provider, then retry.");
        return { key: "test/model", run };
      },
    });

    await controller.refresh();
    expectNoReview(controller, "error");
    expect(controller.model()).toMatchObject({ message: expect.stringMatching(/configure.*retry/i), canRefresh: true });
    expect(run).not.toHaveBeenCalled();

    configured = true;
    await controller.refresh();
    expectTitle(controller, "Quota review");
  });

  test("shows loading during the provider call and lets the reviewer retry a provider failure", async () => {
    const { root } = repo();
    editPolicy(root, 1);
    const gate = pause();
    let fails = true;
    const { controller } = state(location(root), {
      async run(snapshot, evidence) {
        if (fails) {
          await gate.wait();
          throw new Error("Analysis provider unavailable. Retry after reconnecting.");
        }
        return review(snapshot, evidence);
      },
    });

    await gate.whilePending(controller.refresh(), () => {
      expectNoReview(controller, "loading");
      expect(controller.model()).toMatchObject({ message: expect.stringMatching(/analyzing/i), canRefresh: false });
    });
    expectNoReview(controller, "error");
    expect(controller.model()).toMatchObject({ message: expect.stringMatching(/unavailable.*retry/i), canRefresh: true });

    fails = false;
    await controller.refresh();
    expectTitle(controller, "Quota review");
  });

  test("reuses an exact revision and provider key, but reruns for a new provider key", async () => {
    const { root } = repo();
    editPolicy(root, 1);
    let key = "test/model-a";
    const { controller, run } = state(location(root), {
      prepare: (run) => ({ key, run }),
      run: (snapshot, evidence) => review(snapshot, evidence, { title: key }),
    });

    await controller.refresh();
    const id = controller.model().result.groups[0].id;
    controller.toggle(id);
    await controller.refresh();
    expect(run).toHaveBeenCalledTimes(1);
    expectTitle(controller, "test/model-a");
    expect([...controller.model().expanded]).toEqual([id]);

    key = "test/model-b";
    await controller.refresh();
    expect(run).toHaveBeenCalledTimes(2);
    expectTitle(controller, "test/model-b");
  });

  test("marks same-path edits stale and preserves only matching disclosures after refresh", async () => {
    const { root } = repo();
    editPolicy(root, 1);
    write(root, "notes.txt", "review notes\n");
    let revised = false;
    const { controller, run } = state(location(root), {
      run: (snapshot, evidence) => review(snapshot, evidence, {
        title: revised ? "Revised quota" : "Initial quota", ids: [revised ? "new" : "obsolete", "kept"],
      }),
    });

    await controller.refresh();
    expect([...controller.model().expanded]).toEqual([]);
    controller.toggle("obsolete");
    controller.toggle("kept");
    expect(controller.model().expanded).toEqual(new Set(["obsolete", "kept"]));

    editPolicy(root, 2);
    revised = true;
    await controller.probe();
    expect(controller.model()).toMatchObject({ status: "stale", canNavigate: false, message: expect.stringMatching(/refresh/i) });
    expect(run).toHaveBeenCalledTimes(1);

    await controller.refresh();
    expect(run).toHaveBeenCalledTimes(2);
    const [[before], [after]] = run.mock.calls;
    expect(after.files).toEqual(before.files);
    expect(after.revision).not.toBe(before.revision);
    expect(after.patch).toContain(`+${change(2).trimEnd()}`);
    expectTitle(controller, "Revised quota");
    expect([...controller.model().expanded]).toEqual(["kept"]);
  });

  test("clears the review when a probe verifies that the scope is now empty", async () => {
    const { root } = repo();
    editPolicy(root, 1);
    const { controller, run } = state(location(root));
    await controller.refresh();
    expectTitle(controller, "Quota review");
    controller.toggle(controller.model().result.groups[0].id);
    await controller.openFile(policyPath);
    expect(controller.model().detail?.title).toBe(policyPath);

    write(root, policyPath, original);
    await controller.probe();
    expectNoReview(controller, "empty");
    expect(run).toHaveBeenCalledTimes(1);
  });

  test("isolates identical changes across machines and linked worktrees", async () => {
    const { root } = repo();
    editPolicy(root, 1);
    const linked = directory();
    git(root, "worktree", "add", "--detach", linked, "HEAD");
    editPolicy(linked, 1);
    const { controller, run, select } = state(location(root), {
      run: (snapshot, evidence) => review(snapshot, evidence, { title: snapshot.on ?? "Local quota" }),
    });
    await controller.refresh();
    controller.toggle(controller.model().result.groups[0].id);
    await controller.openFile(policyPath);
    expect(controller.model().detail?.title).toBe(policyPath);

    select(location(root, "review-ssh"));
    expectNoReview(controller, "idle");
    await controller.probe();
    expectNoReview(controller, "idle");
    expect([...controller.model().expanded]).toEqual([]);
    expect(controller.model().scopeLabel).toContain(`review-ssh:${root}`);
    await controller.refresh();
    expectTitle(controller, "review-ssh");

    select(location(linked, "review-ssh", "linked-review"));
    await controller.probe();
    expectNoReview(controller, "idle");
    expect([...controller.model().expanded]).toEqual([]);
    expect(controller.model().scopeLabel).toContain(`review-ssh:${linked}`);
    await controller.refresh();
    expect(run).toHaveBeenCalledTimes(3);
    const snapshots = run.mock.calls.map(([snapshot]) => snapshot);
    expect(snapshots.map(({ root, on }) => [root, on])).toEqual([
      [root, null], [root, "review-ssh"], [linked, "review-ssh"],
    ]);
    expect(new Set(snapshots.map(({ patch }) => patch)).size).toBe(1);
    expectTitle(controller, "review-ssh");
  });

  test("does not send old Git evidence if the same file changes while evidence is collected", async () => {
    const { root } = repo();
    editPolicy(root, 1);
    const gate = pause();
    const { controller, run } = state(location(root), {
      async exec(program, args, options) {
        if (args.includes("grep")) await gate.wait();
        return exec(program, args, options);
      },
    });

    await gate.whilePending(controller.refresh(), () => editPolicy(root, 2));
    expect(run).not.toHaveBeenCalled();
    expect(controller.model()).toMatchObject({ status: "stale", canRefresh: true, canNavigate: false });
    await controller.refresh();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0][0].patch).toContain(`+${change(2).trimEnd()}`);
    expectTitle(controller, "Quota review");
  });

  test("does not publish a provider response if the diff changed while the provider worked", async () => {
    const { root } = repo();
    editPolicy(root, 1);
    const gate = pause();
    const { controller, run } = state(location(root), {
      async run(snapshot, evidence) {
        const older = snapshot.patch.includes(`+${change(1).trimEnd()}`);
        if (older) await gate.wait();
        return review(snapshot, evidence, { title: older ? "Old quota" : "Current quota" });
      },
    });

    await gate.whilePending(controller.refresh(), () => editPolicy(root, 2));
    expectNoReview(controller, "stale");
    expect(controller.model().canRefresh).toBe(true);

    await controller.refresh();
    expect(run).toHaveBeenCalledTimes(2);
    expectTitle(controller, "Current quota");
  });

  test.each(["scope", "location", "close"])("isolates pending provider completion after a %s transition", async (transition) => {
    const { root } = topic();
    const gate = pause();
    const { controller, run, select } = state(location(root), {
      async run(snapshot, evidence) {
        const initial = snapshot.on === null && snapshot.scope.kind === "worktree";
        if (initial) await gate.wait();
        return review(snapshot, evidence, { title: initial ? "Old result" : "Selected result" });
      },
    });

    await gate.whilePending(controller.refresh(), async () => {
      if (transition === "close") controller.close();
      else if (transition === "scope") controller.setScope(branch);
      else select(location(root, "review-ssh"));
      expectNoReview(controller, "idle");
      if (transition !== "close") {
        await controller.refresh();
        expectTitle(controller, "Selected result");
      }
    });

    if (transition === "close") {
      await controller.probe();
      await controller.refresh();
      expectNoReview(controller, "idle");
      expect(run).toHaveBeenCalledTimes(1);
    } else {
      expectTitle(controller, "Selected result");
    }
  });
});

describe("Review Assistant navigation", () => {
  test("opens a selected file diff from the exact comparison scope on the selected machine", async () => {
    const { root, base, head } = topic();
    write(root, "local-only.txt", "outside the comparison\n");
    const read = mock(exec);
    const { controller, run } = state(location(root, "review-ssh"), { scope: branch, exec: read });
    await controller.refresh();
    expect(run.mock.calls[0][0]).toMatchObject({ base, head, scope: branch });
    expect(controller.model().scopeLabel).toContain("Compare with main");

    read.mockClear();
    await controller.openFile("local-only.txt");
    expect(read).not.toHaveBeenCalled();
    expect(controller.model().detail).toBeNull();

    await controller.openFile(policyPath);
    const { detail } = controller.model();
    expect(detail?.title).toBe(policyPath);
    expect(detail?.text).toContain(`+${change(1).trimEnd()}`);
    expect(detail?.text).not.toContain(change(2).trimEnd());
    expect(detail?.text).not.toContain("local-only.txt");
    expect(read.mock.calls.every(([, , options]) => options.cwd === root && options.on === "review-ssh")).toBe(true);

    controller.setScope(worktree);
    expectNoReview(controller, "idle");
    await controller.refresh();
    await controller.openFile(policyPath);
    expect(controller.model().detail?.text).toContain(`+${change(2).trimEnd()}`);
    expect(controller.model().detail?.text).not.toContain("local-only.txt");
  });

  test("opens canonical source references but rejects invalid and stale navigation", async () => {
    const { root } = topic();
    const read = mock(exec);
    const { controller } = state(location(root), { scope: branch, exec: read });
    await controller.refresh();
    const [canonical] = controller.model().result.influence[0].references;
    expect(canonical).toEqual(reference);

    read.mockClear();
    for (const invalid of [null, { ...canonical, path: `../${callerPath}` }, { ...canonical, line: 1 }, { ...canonical, symbol: "readQuota" }]) {
      await controller.openReference(invalid);
    }
    expect(read).not.toHaveBeenCalled();
    expect(controller.model().detail).toBeNull();

    await controller.openReference({ ...canonical });
    expect(controller.model().detail).toMatchObject({ title: callerPath, line: 2 });
    expect(controller.model().detail.text).toContain("> 2 |   return calculateQuota(account);");

    write(root, callerPath, "// The caller is no longer unchanged.\n");
    await controller.openReference(canonical);
    expect(controller.model()).toMatchObject({ status: "stale", detail: null, canNavigate: false });

    read.mockClear();
    await controller.openReference(canonical);
    await controller.openFile(policyPath);
    expect(read).not.toHaveBeenCalled();
    expect(controller.model().detail).toBeNull();
  });

  test.each(["dismissed diff", "changed scope", "closed controller"])("does not publish a pending preview after %s", async (transition) => {
    const { root } = topic();
    const gate = pause();
    let hold = false;
    const { controller } = state(location(root), {
      async exec(program, args, options) {
        if (hold) {
          hold = false;
          await gate.wait();
        }
        return exec(program, args, options);
      },
    });
    await controller.refresh();
    expectTitle(controller, "Quota review");
    hold = true;
    const pending = transition === "changed scope"
      ? controller.openReference(controller.model().result.influence[0].references[0])
      : controller.openFile(policyPath);
    await gate.whilePending(pending, async () => {
      if (transition === "closed controller") controller.close();
      else if (transition === "dismissed diff") controller.closeDetail();
      else {
        controller.setScope(branch);
        await controller.refresh();
      }
    });
    expect(controller.model()).toMatchObject({
      status: transition === "closed controller" ? "idle" : "ready", detail: null,
    });
  });
});

describe("Review Assistant context and demo", () => {
  const spaces = [
    { id: "local", active: true, folder: "/local", tabs: [{ id: "local-tab", active: true }] },
    { id: "host/remote", folder: "/remote", tabs: [{ id: "host/remote-tab", active: true }] },
  ];
  const panes = [
    { tab: "local-tab", pane: "local-pane", terminal: "local-terminal", cwd: "/local/repo" },
    { tab: "host/remote-tab", pane: "wrong-host-pane", terminal: "other/terminal", cwd: "/wrong/repo", focused: true },
    { tab: "host/remote-tab", pane: "remote-pane", terminal: "host/terminal", cwd: "/remote/repo" },
  ];

  test("uses the active space initially and prefers the focused remote space over it", () => {
    expect(resolveContext([], [], null)).toEqual({ space: null, cwd: null, on: null });
    expect(resolveContext(spaces, panes, null)).toEqual(location("/local/repo", null, "local"));
    expect(resolveContext(spaces, panes, { space: "host/remote", tab: "host/remote-tab", pane: "remote-pane" }))
      .toEqual(location("/remote/repo", "host", "host/remote"));
  });

  test("only uses a standalone terminal cwd when its machine matches the selected space", () => {
    const focused = { space: "host/remote", tab: "host/remote-tab", pane: null, cwd: "/standalone" };
    expect(resolveContext(spaces, panes, { ...focused, terminal: "host/standalone" }))
      .toEqual(location("/standalone", "host", "host/remote"));
    expect(resolveContext(spaces, panes, { ...focused, terminal: "other/standalone" }))
      .toEqual(location("/remote/repo", "host", "host/remote"));
  });

  test("expands only the demo's first group", () => {
    const { expanded, result } = demoReview();
    expect(result.groups.length).toBeGreaterThan(1);
    expect([...expanded]).toEqual([result.groups[0].id]);
  });
});
