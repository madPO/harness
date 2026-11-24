import { afterEach, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCoreExecutor } from "../herdr/mods/review-assistant/core-exec.js";

const TOKEN = `review-assistant-stage-${"d".repeat(32)}-AbCd12`;
const EVIDENCE = "sensitive fixture evidence 🪴\n";
const argv = ["sandbox wrapper", "--", "", "$HOME; touch example", "a\"b\\c"];
const request = { argv, on: "work-linux", cwd: "/repos/a project", input: EVIDENCE, timeout: 120 };
const framed = ({ code = 0, timed_out = false, truncated = false, stdout = "" } = {}) => ({
  code: 0,
  stdout: `${JSON.stringify({ code, timed_out, truncated, length: stdout.length })}\n${stdout}`,
  stderr: EVIDENCE,
});

function adapter({ submit = () => framed(), write = () => null, home = "/home/customer/app" } = {}) {
  const calls = [], writes = [];
  const coreExec = createCoreExecutor({
    appHome: () => home,
    exec: async (command, args, options) => {
      calls.push({ command, args, options });
      if (args[1] === "stage") return { code: 0, stdout: `${TOKEN}\n` };
      if (args[1] === "submit") return submit();
      if (args[1] === "cleanup") return { code: 0, stdout: "" };
      throw new Error("Unexpected native invocation");
    },
    writeTextFile: async (...args) => {
      writes.push(args);
      return write(...args);
    },
  });
  return { coreExec, calls, writes };
}

describe("Review Assistant Desktop Core executor", () => {
  test("keeps evidence out of execution arguments and preserves selected argv", async () => {
    const home = "C:\\Users\\Review User\\AppData\\Local\\Herdr\\";
    const root = home.slice(0, -1);
    const script = `${root}\\mods\\review-assistant\\core-bridge.js`;
    const { coreExec, calls, writes } = adapter({ home, submit: () => framed({ stdout: "résultat 🛠\n" }) });
    expect(await coreExec(request)).toEqual({ code: 0, timed_out: false, truncated: false, stdout: "résultat 🛠\n" });
    expect(calls).toEqual([
      { command: "bun", args: [script, "stage"], options: { on: null, timeout: 10_000 } },
      { command: "bun", args: [script, "submit", TOKEN], options: { on: null, timeout: 135_000 } },
    ]);
    expect(JSON.stringify(calls)).not.toContain(EVIDENCE.trim());
    expect(writes).toHaveLength(1);
    expect(writes[0][0]).toBe(`${root}\\${TOKEN}\\request.json`);
    expect(JSON.parse(writes[0][1])).toEqual(request);
    expect(writes[0][2]).toBeNull();
  });

  test("allows explicit local Core but rejects missing and malformed machine values before staging", async () => {
    const { coreExec, calls, writes } = adapter();
    for (const on of [undefined, "", " ", false, 1, "bad\nname"]) {
      await expect(coreExec({ ...request, on })).rejects.toThrow(/selected Linux workspace/);
    }
    expect(calls).toEqual([]);
    expect(writes).toEqual([]);
    await coreExec({ ...request, on: null });
    expect(JSON.parse(writes[0][1]).on).toBeNull();
  });

  test("returns only the worker stdout and status, including timeouts, truncation, and nonzero exits", async () => {
    for (const result of [
      { code: null, timed_out: true, truncated: false, stdout: "partial" },
      { code: 0, timed_out: false, truncated: true, stdout: "partial" },
      { code: 4, timed_out: false, truncated: false, stdout: "" },
    ]) {
      const { coreExec } = adapter({ submit: () => framed(result) });
      expect(await coreExec(request)).toEqual(result);
    }
  });

  test("cleans up after a failed write, rejected dispatch, or malformed result without retrying", async () => {
    const abort = () => { throw new Error(EVIDENCE); };
    for (const [options, expectedModes, message] of [
      [{ write: abort }, ["stage", "cleanup"], /write the private review request/],
      [{ submit: abort }, ["stage", "submit", "cleanup"], /Herdr Core/],
      [{ submit: () => ({ code: 1, stderr: EVIDENCE }) }, ["stage", "submit", "cleanup"], /Herdr Core/],
      [{ submit: () => ({ code: 0, stdout: `${framed().stdout}unexpected`, stderr: EVIDENCE }) }, ["stage", "submit", "cleanup"], /Herdr Core/],
      [{ submit: () => ({ code: 2, stderr: EVIDENCE }) }, ["stage", "submit", "cleanup"], /did not reply in time/],
    ]) {
      const { coreExec, calls, writes } = adapter(options);
      await expect(coreExec(request)).rejects.toThrow(message);
      expect(calls.map(({ args }) => args[1])).toEqual(expectedModes);
      expect(calls.at(-1).args.at(-1)).toBe(TOKEN);
      expect(JSON.parse(writes[0][1]).on).toBe(request.on);
    }
  });
});

const directories = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function installBridge() {
  const parent = process.platform === "win32" ? process.env.LOCALAPPDATA ?? homedir() : tmpdir();
  const root = mkdtempSync(join(parent, "review-core-test-"));
  directories.push(root);
  const mod = join(root, "mods", "review-assistant");
  mkdirSync(mod, { recursive: true });
  const script = join(mod, "core-bridge.js");
  copyFileSync(fileURLToPath(new URL("../herdr/mods/review-assistant/core-bridge.js", import.meta.url)), script);
  const run = (...args) => Bun.spawnSync([process.execPath, script, ...args], { stderr: "pipe", stdout: "pipe" });
  return { root, run };
}

function stage(run) {
  const result = run("stage");
  expect(result.exitCode).toBe(0);
  return result.stdout.toString().trimEnd();
}

describe("Review Assistant private staging helper", () => {
  test("issues unique private directories and removes malformed staged evidence before failing", () => {
    const { root, run } = installBridge();
    const first = stage(run), second = stage(run);
    expect(first).not.toBe(second);
    const folder = join(root, first);
    if (process.platform !== "win32") expect(statSync(folder).mode & 0o777).toBe(0o700);
    writeFileSync(join(folder, "request.json"), EVIDENCE, { flag: "wx" });
    const failure = run("submit", first);
    expect(failure.exitCode).not.toBe(0);
    expect(failure.stdout.toString() + failure.stderr.toString()).toBe("");
    expect(existsSync(folder)).toBe(false);
    expect(run("cleanup", first).exitCode).toBe(0);
    expect(run("cleanup", second).exitCode).toBe(0);
    expect(existsSync(join(root, second))).toBe(false);
  });

  test("refuses unissued paths and never follows a symlink outside a stage", () => {
    const { root, run } = installBridge();
    const unissued = join(root, TOKEN);
    mkdirSync(unissued, { mode: 0o700 });
    writeFileSync(join(unissued, "request.json"), "outside evidence");
    expect(run("cleanup", TOKEN).exitCode).not.toBe(0);
    expect(run("cleanup", `../${TOKEN}`).exitCode).not.toBe(0);

    const token = stage(run);
    const folder = join(root, token);
    rmSync(folder, { recursive: true });
    symlinkSync(unissued, folder, process.platform === "win32" ? "junction" : "dir");
    expect(run("cleanup", token).exitCode).not.toBe(0);
    expect(run("submit", token).exitCode).not.toBe(0);
    expect(readFileSync(join(unissued, "request.json"), "utf8")).toBe("outside evidence");
  });
});
