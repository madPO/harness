const STAGE_TIMEOUT = 10_000;
const NATIVE_GRACE_MS = 15_000;
const MAX_TIMEOUT_SECONDS = 585;
const STAGE_TOKEN = /^review-assistant-stage-[a-f0-9]{32}-[A-Za-z0-9]{6}$/;
const STAGE_FAILURE = "Could not prepare private review files. Check that Bun is on the Herdr Desktop PATH and the app home is private and writable.";
const BRIDGE_FAILURE = "Could not reach the review launcher through Herdr Core. Check the Desktop PATH for hc or herdr-core and check the workspace connection.";
const CLEANUP_FAILURE = "Could not remove private review files. Close Review Assistant and remove leftover review-assistant-stage-* folders from the app home.";

function appPaths(home) {
  if (typeof home !== "string" || home.includes("\0")) return null;
  const windows = /^[A-Za-z]:[\\/]|^\\\\/.test(home);
  if (!windows && !home.startsWith("/")) return null;
  const separator = windows ? "\\" : "/";
  const base = home.replace(windows ? /[\\/]+$/ : /\/+$/, "");
  return (...parts) => [base, ...parts].join(separator);
}

function validRequest({ argv, on, cwd, input, timeout }) {
  if (!Array.isArray(argv) || argv.length === 0 || !argv[0]) return false;
  for (const arg of argv) {
    if (typeof arg !== "string" || arg.includes("\0")) return false;
  }
  return (on === null || (typeof on === "string" && on.length > 0 && on.trim() === on && !/[\0\r\n]/.test(on)))
    && typeof cwd === "string" && cwd.startsWith("/") && !cwd.includes("\0")
    && typeof input === "string" && Number.isFinite(timeout) && timeout > 0 && timeout <= MAX_TIMEOUT_SECONDS;
}

function readResult(result) {
  if (result?.code === 2) throw new Error("Herdr Core did not reply in time. Check the selected workspace connection.");
  if (result?.code !== 0 || typeof result.stdout !== "string") throw new Error(BRIDGE_FAILURE);

  // Keep stdout out of the JSON header to avoid expanding it past the native exec output limit.
  const newline = result.stdout.indexOf("\n");
  if (newline < 0 || newline > 256) throw new Error(BRIDGE_FAILURE);
  let header;
  try {
    header = JSON.parse(result.stdout.slice(0, newline));
  } catch {
    throw new Error(BRIDGE_FAILURE);
  }
  const { code, length, timed_out, truncated } = header ?? {};
  if (!(code === null || Number.isInteger(code)) || typeof timed_out !== "boolean"
    || typeof truncated !== "boolean" || length !== result.stdout.length - newline - 1) {
    throw new Error(BRIDGE_FAILURE);
  }
  return { code, timed_out, truncated, stdout: result.stdout.slice(newline + 1) };
}

export function createCoreExecutor({ exec, writeTextFile, appHome }) {
  return async (request) => {
    if (!request || !validRequest(request)) {
      throw new Error("Review execution requires a selected Linux workspace, an exact launch, and a valid timeout.");
    }
    const { argv, on, cwd, input, timeout } = request;
    const payload = JSON.stringify({ argv, on, cwd, input, timeout });
    const paths = appPaths(appHome());
    if (!paths) throw new Error(STAGE_FAILURE);
    const script = paths("mods", "review-assistant", "core-bridge.js");
    const run = async (args, limit, failure) => {
      try {
        return await exec("bun", [script, ...args], { on: null, timeout: limit });
      } catch {
        throw new Error(failure);
      }
    };
    const stage = await run(["stage"], STAGE_TIMEOUT, STAGE_FAILURE);
    const token = typeof stage?.stdout === "string" ? stage.stdout.trimEnd() : "";
    if (stage?.code !== 0 || !STAGE_TOKEN.test(token)) throw new Error(STAGE_FAILURE);

    let consumed = false;
    try {
      try {
        await writeTextFile(paths(token, "request.json"), payload, null);
      } catch {
        throw new Error("Could not write the private review request. Check the app-home permissions or review fewer changes.");
      }
      const result = await run(["submit", token], Math.ceil(timeout * 1000) + NATIVE_GRACE_MS, BRIDGE_FAILURE);
      const decoded = readResult(result);
      consumed = true;
      return decoded;
    } finally {
      if (!consumed) {
        const cleanup = await run(["cleanup", token], STAGE_TIMEOUT, CLEANUP_FAILURE);
        if (cleanup?.code !== 0) throw new Error(CLEANUP_FAILURE);
      }
    }
  };
}
