import { parseRefs } from "./model.js";

// Disable optional writes and fsmonitor hooks; every command reads local refs only.
export const READ = ["--no-optional-locks", "--literal-pathspecs", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
export const REFS = ["for-each-ref", "--format=%(refname)%00%(symref)%00%(HEAD)", "refs/heads", "refs/remotes"];
const run = (exec, context, args) => exec("git", [...READ, ...args], { cwd: context.root ?? context.cwd, on: context.on ?? null });
const message = (result) => (result.stderr || result.stdout || `Git exited with code ${result.code}`).trim();

export async function readSnapshot(context, exec) {
  if (!context.cwd) return { ...context, state: "nofolder", branches: [] };
  const top = await run(exec, context, ["rev-parse", "--show-toplevel"]);
  if (top.code !== 0) {
    if (/not a git repository|must be run in a work tree/i.test(top.stderr)) return { ...context, state: "norepo", branches: [] };
    throw new Error(message(top));
  }
  const repo = { ...context, root: top.stdout.replace(/\r?\n$/, "") };
  const result = await run(exec, repo, REFS);
  if (result.code !== 0) throw new Error(message(result));
  return { ...repo, state: "ready", branches: parseRefs(result.stdout) };
}
