// Runs in Bun on the Desktop machine, not in Herdr's mod JavaScript runtime.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const STAGE_PREFIX = "review-assistant-stage-";
const STAGE_TOKEN = /^review-assistant-stage-[a-f0-9]{32}-[A-Za-z0-9]{6}$/;
const MARKER = "issued";
const PAYLOAD = "request.json";
const FILE_LIMIT = 1024 * 1024; // Desktop's native text-write limit.
const STDOUT_LIMIT = 4 * 1024 * 1024;
const CORE_STDOUT_LIMIT = 8 * 1024 * 1024;
const CORE_STDERR_LIMIT = 1024 * 1024;
const FRAME_LIMIT = 4 * (Math.ceil(CORE_STDOUT_LIMIT / 3) + Math.ceil(CORE_STDERR_LIMIT / 3)) + 4096;
const CONNECT_TIMEOUT = Symbol("connect timeout");
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const WINDOWS = process.platform === "win32";

function lstat(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return null;
  }
}

function inUserProfile(root, profile) {
  if (!profile || !isAbsolute(profile)) return false;
  try {
    const path = relative(realpathSync(profile), root);
    return !isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`);
  } catch {
    return false;
  }
}

function appRoot() {
  const script = fileURLToPath(import.meta.url);
  const mod = dirname(script), mods = dirname(mod);
  if (basename(mod) !== "review-assistant" || basename(mods) !== "mods") throw new Error();
  const root = realpathSync(dirname(mods));
  const stat = lstatSync(root);
  // The staging directory must be inside app home for writeTextFile. On Windows it inherits user-profile ACLs.
  if (!stat.isDirectory() || (WINDOWS
    ? !inUserProfile(root, process.env.LOCALAPPDATA) && !inUserProfile(root, homedir())
    : stat.uid !== process.getuid() || (stat.mode & 0o022) !== 0)) throw new Error();
  return root;
}

function unlinkIfPresent(path) {
  try {
    unlinkSync(path);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function createStage(root) {
  const stage = mkdtempSync(join(root, `${STAGE_PREFIX}${randomBytes(16).toString("hex")}-`));
  try {
    writeFileSync(join(stage, MARKER), "", { flag: "wx", mode: 0o600 });
    return basename(stage);
  } catch (error) {
    unlinkIfPresent(join(stage, MARKER));
    rmdirSync(stage);
    throw error;
  }
}

function findStage(root, token) {
  if (!STAGE_TOKEN.test(token) || token.length !== STAGE_PREFIX.length + 39) throw new Error();
  const stage = join(root, token);
  const stat = lstat(stage);
  if (!stat) return null;
  if (!stat.isDirectory() || (!WINDOWS && (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0))) throw new Error();
  const marker = lstat(join(stage, MARKER));
  if (!marker?.isFile() || marker.size !== 0 || marker.nlink !== 1) throw new Error();
  return stage;
}

function removeStage(stage) {
  // Never recurse, and only remove files with names owned by the staging protocol.
  unlinkIfPresent(join(stage, PAYLOAD));
  unlinkSync(join(stage, MARKER));
  rmdirSync(stage);
}

function takeRequest(stage) {
  const path = join(stage, PAYLOAD);
  let bytes;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > FILE_LIMIT) throw new Error();
    bytes = readFileSync(path);
  } finally {
    removeStage(stage);
  }
  if (bytes.length > FILE_LIMIT) throw new Error();
  const { argv, on, cwd, input, timeout } = JSON.parse(UTF8.decode(bytes));
  if (!Array.isArray(argv) || argv.length === 0 || !argv[0]
    || !argv.every((arg) => typeof arg === "string" && !arg.includes("\0"))
    || !(on === null || (typeof on === "string" && on.length > 0 && on.trim() === on && !/[\0\r\n]/.test(on)))
    || typeof cwd !== "string" || !cwd.startsWith("/") || cwd.includes("\0")
    || typeof input !== "string" || !Number.isFinite(timeout) || timeout <= 0 || timeout > 585) throw new Error();
  return { argv, on, cwd, input: Buffer.from(input, "utf8").toString("base64"), timeout };
}

async function connect(params) {
  const line = `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "machine.exec", params })}\n`;
  const binary = globalThis.Bun
    ? Bun.which("hc") ?? Bun.which("herdr-core")
    : "hc";
  if (!binary) throw new Error();
  const child = spawn(binary, ["connect"], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      const chunks = [];
      let bytes = 0;
      timer = setTimeout(() => reject(CONNECT_TIMEOUT), Math.ceil(params.timeout * 1000) + 10_000);
      child.on("error", reject);
      child.stdin.on("error", reject);
      child.stdout.on("error", reject);
      child.stdout.once("end", () => reject(new Error()));
      child.stdout.on("data", (chunk) => {
        const newline = chunk.indexOf(10);
        const part = newline < 0 ? chunk : chunk.subarray(0, newline);
        bytes += part.length;
        if (bytes > FRAME_LIMIT) {
          child.stdout.pause();
          reject(new Error());
          return;
        }
        chunks.push(part);
        if (newline >= 0) {
          child.stdout.pause();
          resolve(Buffer.concat(chunks, bytes));
        }
      });
      // hc connect aborts requests when its stdin closes. Core closes the worker's own stdin after feeding it.
      child.stdin.write(line);
    });
  } finally {
    clearTimeout(timer);
    child.kill("SIGKILL");
    child.stdin.destroy();
    child.stdout.destroy();
  }
}

function decodeReply(bytes) {
  const response = JSON.parse(UTF8.decode(bytes));
  if (response?.jsonrpc !== "2.0" || response.id !== 1 || Object.hasOwn(response, "error")) throw new Error();
  const { code, stdout: encoded, stderr: encodedError, timed_out } = response.result ?? {};
  let { truncated } = response.result ?? {};
  if (!(code === null || Number.isInteger(code)) || typeof timed_out !== "boolean"
    || typeof truncated !== "boolean") throw new Error();
  const decode = (value, limit) => {
    if (typeof value !== "string" || value.length % 4 !== 0
      || !/^[A-Za-z0-9+/]*={0,2}(?![\s\S])/.test(value)) throw new Error();
    const size = value.length / 4 * 3 - (value.endsWith("==") ? 2 : Number(value.endsWith("=")));
    if (size > limit) throw new Error();
    const data = Buffer.from(value, "base64");
    try {
      return UTF8.decode(data);
    } catch (error) {
      if (!timed_out && !truncated && code === 0) throw error;
      truncated = true;
      return new TextDecoder("utf-8", { ignoreBOM: true }).decode(data);
    }
  };
  let stdout = decode(encoded, CORE_STDOUT_LIMIT);
  const stderr = decode(encodedError, CORE_STDERR_LIMIT);
  if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > STDOUT_LIMIT - 4096) {
    stdout = "";
    truncated = true;
  }
  return { code, timed_out, truncated, stdout, stderr };
}

try {
  const args = process.argv.slice(2);
  const [mode, token] = args;
  if (mode === "stage" && args.length === 1) {
    process.stdout.write(`${createStage(appRoot())}\n`);
  } else if ((mode === "submit" || mode === "cleanup") && args.length === 2) {
    const stage = findStage(appRoot(), token);
    if (mode === "cleanup") {
      if (stage) removeStage(stage);
    } else {
      if (!stage) throw new Error();
      const { code, timed_out, truncated, stdout, stderr } = decodeReply(await connect(takeRequest(stage)));
      process.stdout.write(`${JSON.stringify({ code, timed_out, truncated, length: stdout.length, stderrLength: stderr.length })}\n`);
      process.stdout.write(stdout + stderr);
    }
  } else {
    throw new Error();
  }
} catch (error) {
  // Never print payload, stderr, or arbitrary Core/OS errors.
  process.exitCode = error === CONNECT_TIMEOUT ? 2 : 1;
}
