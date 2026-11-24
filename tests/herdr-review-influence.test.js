import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readSnapshot } from "../herdr/mods/review-assistant/git.js";
import { readInfluenceEvidence, readInfluenceSource } from "../herdr/mods/review-assistant/influence.js";

const worktree = { kind: "worktree" };
const location = (cwd, on = null) => ({ space: "review", cwd, on });
const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };
const directories = [];

function directory() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "review-influence-")));
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
  return result.stdout.trim();
}

const exec = async (program, args, { cwd }) => run(program, args, cwd);

function write(root, path, text) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
}

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
  return git(root, "rev-parse", "HEAD");
}

function recordExec() {
  const commands = [];
  return {
    commands,
    read: async (program, args, options) => {
      commands.push({ program, args, ...options });
      return exec(program, args, options);
    },
  };
}

function referenceOf({ path, symbol, line }) {
  return { path, symbol, line };
}

afterEach(() => {
  for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Review Assistant influence evidence", () => {
  test("finds an unchanged caller and previews pinned source on the selected machine", async () => {
    const root = repo();
    const caller = ":(glob)*: refresh\ncaller.js";
    const policy = "export function validateSession(session) {\n  return session.active;\n}\n";
    write(root, "session-policy.js", policy);
    write(root, caller, "export function refreshSession(session) {\n  return validateSession(session);\n}\n");
    write(root, "examples.md", "validateSession(session)\n");
    write(root, "false-matches.js", [
      "// validateSession(session)",
      "const message = 'validateSession(session)';",
      "/*",
      "validateSession(session);",
      "*/",
      "const example = `",
      "validateSession(session)",
      "`;",
      "validateSessionBackup(session);",
    ].join("\n"));
    write(root, ".gitignore", "ignored.js\ntracked-ignored.js\n");
    write(root, "ignored.js", "validateSession(session);\n");
    write(root, "tracked-ignored.js", "validateSession(session);\n");
    git(root, "add", "-f", "tracked-ignored.js");
    const head = commit(root, "Session policy and caller");
    write(root, "session-policy.js", policy.replace("session.active", "session.active && !session.revoked"));
    write(root, "untracked.js", "validateSession(session);\n");
    const { commands, read } = recordExec();
    const snapshot = await readSnapshot(exec, location(root, "review-ssh"), worktree);

    const evidence = await readInfluenceEvidence(read, snapshot);
    expect(evidence.map(referenceOf)).toEqual([{ path: caller, symbol: "validateSession", line: 2 }]);
    expect(evidence[0].text).toContain("export function refreshSession(session)");
    expect(evidence[0].text).toContain("return validateSession(session);");
    await expect(readInfluenceSource(read, snapshot, { path: "tracked-ignored.js", symbol: "validateSession", line: 1 })).rejects.toThrow("ignored");

    write(root, caller, "// unrelated replacement in newer HEAD\n");
    expect(commit(root, "Replace the caller later")).not.toBe(head);
    const preview = await readInfluenceSource(read, snapshot, referenceOf(evidence[0]));
    expect(preview).toMatchObject({ title: caller, line: 2 });
    expect(preview.text).toContain("export function refreshSession(session)");
    expect(preview.text).toContain("> 2 |   return validateSession(session);");
    expect(preview.text).not.toContain("unrelated replacement");
    await expect(readInfluenceSource(read, snapshot, { ...referenceOf(evidence[0]), line: 1 })).rejects.toThrow("no longer matches");
    await expect(readInfluenceSource(read, snapshot, { ...referenceOf(evidence[0]), path: "../caller.js" })).rejects.toThrow("valid unchanged source");

    expect(commands.every(({ program, cwd, on }) => program === "git" && cwd === root && on === "review-ssh")).toBe(true);
    const grep = commands.find(({ args }) => args.includes("grep")).args;
    expect(grep).toContain("--fixed-strings");
    expect(grep).toContain("--word-regexp");
    expect(grep).toContain("--no-textconv");
    expect(grep).toContain("--no-recurse-submodules");
    expect(grep).toContain("--null");
    expect(grep.slice(-2)).toEqual([head, "--"]);
    expect(grep[grep.indexOf("validateSession") - 1]).toBe("-e");
    const inventories = commands.filter(({ args }) => args.includes("ls-tree"));
    expect(inventories.every(({ args }) => args.includes(head))).toBe(true);
  });

  test("excludes changed and locally dirty paths from a branch comparison", async () => {
    const root = repo();
    const policy = "export function calculateQuota(account) {\n  return account.limit;\n}\n";
    write(root, "quota.js", policy);
    write(root, "clean.js", "calculateQuota(cleanAccount);\n");
    write(root, "modified.js", "calculateQuota(modifiedAccount);\n");
    write(root, "staged.js", "calculateQuota(stagedAccount);\n");
    write(root, "removed.js", "calculateQuota(removedAccount);\n");
    commit(root, "Quota callers");
    git(root, "switch", "-c", "topic");
    write(root, "quota.js", policy.replace("account.limit", "account.limit - account.used"));
    write(root, "topic.js", "calculateQuota(topicAccount);\n");
    write(root, "tmp/peer.js", "calculateQuota(peerAccount);\n");
    commit(root, "Review the quota rule");
    write(root, "modified.js", "calculateQuota(localAccount);\n");
    write(root, "staged.js", "calculateQuota(otherAccount);\n");
    git(root, "add", "staged.js");
    rmSync(join(root, "removed.js"));
    write(root, "untracked.js", "calculateQuota(untrackedAccount);\n");
    const snapshot = await readSnapshot(exec, location(root), { kind: "branch", target: "main" });
    expect(snapshot.dirtyPaths).toEqual(["modified.js", "removed.js", "staged.js", "untracked.js"]);
    expect((await readInfluenceEvidence(exec, snapshot)).map(referenceOf)).toEqual([
      { path: "clean.js", symbol: "calculateQuota", line: 1 },
    ]);
    for (const path of ["modified.js", "removed.js", "staged.js", "topic.js", "quota.js"]) {
      await expect(readInfluenceSource(exec, snapshot, { path, symbol: "calculateQuota", line: 1 })).rejects.toThrow("valid unchanged source");
    }
  });

  test("searches old module names and removed declarations without returning renamed or deleted paths", async () => {
    const root = repo();
    write(root, "services/ledger-rules.js", "checkLegacyLedger(ledger);\n");
    write(root, "legacy-check.js", "export function checkLegacyLedger(ledger) { return ledger.version === 1; }\n");
    write(root, "audit.js", "import './services/ledger-rules.js';\ncheckLegacyLedger(currentLedger);\n");
    write(root, "elsewhere/consumer.js", "import './ledger-rules.js';\n");
    write(root, "elsewhere/ledger-rules.js", "export const secondaryLedger = true;\n");
    const head = commit(root, "Ledger rules and legacy support");
    git(root, "mv", "services/ledger-rules.js", "services/ledger-policy.js");
    git(root, "rm", "legacy-check.js");
    const snapshot = await readSnapshot(exec, location(root), worktree);
    expect(snapshot.files).toEqual([
      { path: "legacy-check.js", status: "D" },
      { path: "services/ledger-policy.js", status: "R", oldPath: "services/ledger-rules.js" },
    ]);
    const evidence = await readInfluenceEvidence(exec, snapshot);
    expect(evidence.map(referenceOf)).toEqual([
      { path: "audit.js", symbol: "checkLegacyLedger", line: 2 },
      { path: "audit.js", symbol: "ledger-rules", line: 1 },
    ]);
    expect((await readInfluenceSource(exec, snapshot, referenceOf(evidence[1]))).text).toContain("import './services/ledger-rules.js'");
    expect(git(root, "rev-parse", "HEAD")).toBe(head);
    for (const path of ["services/ledger-rules.js", "services/ledger-policy.js", "legacy-check.js"]) {
      await expect(readInfluenceSource(exec, snapshot, { path, symbol: "checkLegacyLedger", line: 1 })).rejects.toThrow("valid unchanged source");
    }
  });

  test("collects exact API and persistent key consumers, not incidental string literals", async () => {
    const root = repo();
    write(root, "filter-store.js", "localStorage.setItem('saved-filter', value);\nrouter.get('/api/filters/current', handler);\n");
    write(root, "restore.js", "const savedFilter = localStorage.getItem('saved-filter');\nfetch('/api/filters/current');\n");
    write(root, "unrelated.js", "const labels = ['saved-filter', '/api/filters/current'];\n");
    commit(root, "Filter settings and consumers");
    write(root, "filter-store.js", "localStorage.setItem('saved-filter', compact);\nrouter.get('/api/filters/current', compactHandler);\n");
    const snapshot = await readSnapshot(exec, location(root), worktree);
    const evidence = await readInfluenceEvidence(exec, snapshot);
    expect(evidence.map(referenceOf)).toEqual([
      { path: "restore.js", symbol: "saved-filter", line: 1 },
      { path: "restore.js", symbol: "/api/filters/current", line: 2 },
    ]);
  });

  test("skips oversized objects before reading them and does not follow committed symlinks", async () => {
    const root = repo(), outside = directory();
    write(outside, "private.js", "refreshCatalog(secret);\n");
    symlinkSync(join(outside, "private.js"), join(root, "outside.js"));
    write(root, "catalog.js", "export function refreshCatalog() {\n  return products;\n}\n");
    write(root, "large.js", `refreshCatalog();\n${"// reserve object bytes\n".repeat(10_000)}`);
    commit(root, "Catalog and large object");
    write(root, "catalog.js", "export function refreshCatalog() {\n  return products.filter(active);\n}\n");
    const snapshot = await readSnapshot(exec, location(root), worktree);
    const { commands, read } = recordExec();

    expect(await readInfluenceEvidence(read, snapshot)).toEqual([]);
    await expect(readInfluenceSource(read, snapshot, { path: "large.js", symbol: "refreshCatalog", line: 1 })).rejects.toThrow("exceeds the preview limit");
    await expect(readInfluenceSource(read, snapshot, { path: "outside.js", symbol: "refreshCatalog", line: 1 })).rejects.toThrow("not available in the review commit");
    expect(commands.some(({ args }) => args.includes("ls-tree"))).toBe(true);
    expect(commands.some(({ args }) => args.includes("cat-file"))).toBe(false);
  });

  test("does not search unborn snapshots or derive terms from binary payloads", async () => {
    const root = repo();
    write(root, "first.js", "export function initialFunction() {}\n");
    const unborn = await readSnapshot(exec, location(root), worktree);
    const { commands, read } = recordExec();
    expect(await readInfluenceEvidence(read, unborn)).toEqual([]);
    write(root, "binary.bin", Uint8Array.of(0, 1, 2, 3));
    commit(root, "Binary baseline");
    write(root, "binary.bin", Uint8Array.of(0, 1, 2, 4));
    const binary = await readSnapshot(exec, location(root), worktree);
    expect(binary.patch).toContain("GIT binary patch");
    expect(await readInfluenceEvidence(read, binary)).toEqual([]);
    expect(commands).toEqual([]);
  });
});
