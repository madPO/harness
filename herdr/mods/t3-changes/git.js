import { parseStatus, groupsOf, parseDiff, validPath, commitArgs, repositoryKey } from "./model.js";

// No shell, external diff driver, textconv, fsmonitor, or optional index writes.
export const READ = ["--no-optional-locks", "--literal-pathspecs", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
export const STATUS = ["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"];
const run = (exec, context, args, read = true) => exec("git", [...(read ? READ : ["--literal-pathspecs", "-c", "core.fsmonitor=false"]), ...args], { cwd: context.root ?? context.cwd, on: context.on ?? null });
const message = (result) => (result.stderr || result.stdout || `Git exited with code ${result.code}`).trim();
const checked = (result) => { if (result.code !== 0) throw new Error(message(result)); return result.stdout; };
const stripLF = (text) => text.replace(/\r?\n$/, "");

export async function readIdentity(context, exec) {
  const head = await run(exec, context, ["rev-parse", "--verify", "-q", "HEAD"]);
  const branch = await run(exec, context, ["symbolic-ref", "-q", "HEAD"]);
  if (head.code !== 0 && head.code !== 1) throw new Error(message(head));
  if (branch.code !== 0 && branch.code !== 1) throw new Error(message(branch));
  if (head.code !== 0 && branch.code !== 0) throw new Error("Git couldn't resolve HEAD or the current branch");
  return { head: head.code === 0 ? stripLF(head.stdout) : null, branch: branch.code === 0 ? stripLF(branch.stdout) : null };
}

export async function readSnapshot(context, exec) {
  if (!context.cwd) return { state: "nofolder", files: [], groups: groupsOf([]), ...context };
  const top = await run(exec, context, ["rev-parse", "--show-toplevel"]);
  if (top.code !== 0) {
    if (/not a git repository|must be run in a work tree/i.test(top.stderr)) return { state: "norepo", files: [], groups: groupsOf([]), ...context };
    throw new Error(message(top));
  }
  const repo = { ...context, root: stripLF(top.stdout) };
  const before = await readIdentity(repo, exec);
  const files = parseStatus(checked(await run(exec, repo, STATUS)));
  const after = await readIdentity(repo, exec);
  if (before.head !== after.head || before.branch !== after.branch) throw new Error("Repository changed while loading. Refresh to continue.");
  return { ...repo, ...after, state: "ready", files, groups: groupsOf(files) };
}

export async function readDiff(snapshot, file, exec) {
  if (!validPath(file?.path) || !["staged", "unstaged"].includes(file.group)) throw new Error("Select a changed file");
  if (file.conflict) return [{ kind: "note", text: "Unresolved conflict. Resolve this file outside Changes, then refresh." }];
  const options = ["--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "--unified=3"];
  let result;
  if (file.untracked) {
    // ls-files only returns checkout-relative entries. Git's no-index diff lstat's
    // the final entry: symlinks are diffed as link text, never opened as targets.
    const listed = checked(await run(exec, snapshot, ["ls-files", "--others", "--exclude-standard", "-z", "--", file.path]));
    if (!listed.split("\0").includes(file.path)) throw new Error("This untracked file changed. Refresh to continue.");
    result = await run(exec, snapshot, ["diff", "--no-index", ...options, "--", "/dev/null", file.path]);
    if (result.code !== 0 && result.code !== 1) throw new Error(message(result));
    if (result.code === 1 && !result.stdout) throw new Error(message(result));
  } else {
    result = await run(exec, snapshot, ["diff", ...(file.group === "staged" ? ["--cached"] : []), ...options, "--", file.path]);
    checked(result);
  }
  return parseDiff(result.stdout);
}

// The controller supplies a live context guard. Checks surround every awaited
// preflight read; the final check and exec invocation share one synchronous turn.
export async function perform(snapshot, action, exec, isCurrent = () => true) {
  let attempted = false;
  try {
    const current = () => { if (!isCurrent()) throw new Error("Focus changed. Return to this repository and refresh before trying again."); };
    current();
    if (snapshot.state !== "ready" || !snapshot.root) throw new Error("Load a repository before changing files");
    const fresh = await readSnapshot({ cwd: snapshot.root, on: snapshot.on }, exec);
    current();
    if (fresh.state !== "ready" || repositoryKey(fresh) !== repositoryKey(snapshot) || fresh.head !== snapshot.head || fresh.branch !== snapshot.branch) {
      throw new Error("Repository HEAD or branch changed. Refresh before trying again.");
    }
    const conflicts = fresh.files.some((file) => file.conflict);
    let args;
    if (action.type === "commit") {
      args = commitArgs(action.subject, action.description);
      if (conflicts) throw new Error("Resolve conflicts outside Changes before committing");
      if (!fresh.groups.staged.length) throw new Error("Stage changes before committing");
    } else if (action.type === "stage" || action.type === "unstage") {
      const group = action.type === "stage" ? "unstaged" : "staged";
      const loaded = snapshot.groups[group], available = fresh.groups[group];
      const paths = action.path === undefined ? loaded.map((file) => file.path) : [action.path];
      if (!paths.length) throw new Error("There are no files in this group");
      if (paths.some((path) => !validPath(path) || !loaded.some((file) => file.path === path) || !available.some((file) => file.path === path))) {
        throw new Error("The selected files changed. Refresh before trying again.");
      }
      if (action.type === "stage" && paths.some((path) => fresh.files.some((file) => file.path === path && file.conflict))) {
        throw new Error("Resolve conflicts outside Changes before staging this group");
      }
      args = action.type === "stage" ? ["add", "--", ...paths]
        : fresh.head ? ["reset", "-q", "HEAD", "--", ...paths] : ["rm", "--cached", "--force", "-q", "--", ...paths];
    } else throw new Error("Unknown Changes action");
    current(); attempted = true;
    const result = await run(exec, snapshot, args, false);
    checked(result);
    return { ok: true, attempted };
  } catch (error) {
    return { ok: false, attempted, message: String(error?.message ?? error) };
  }
}
