import { parseStatus, groupsOf, parseDiff, parsePrevious, validPath, commitArgs, repositoryKey } from "./model.js";

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

async function previousCommit(snapshot, exec) {
  if (!snapshot.head) throw new Error("Create a commit before enabling Amend");
  const object = checked(await run(exec, snapshot, ["cat-file", "commit", snapshot.head]));
  const boundary = object.indexOf("\n\n");
  if (boundary < 0) throw new Error("Git returned an invalid commit");
  const parent = /^parent ([0-9a-f]+)$/m.exec(object.slice(0, boundary))?.[1];
  return { message: object.slice(boundary + 2), revisions: parent ? [parent, snapshot.head] : [snapshot.head] };
}

export async function readPrevious(snapshot, exec) {
  const commit = await previousCommit(snapshot, exec);
  const files = parsePrevious(checked(await run(exec, snapshot,
    ["diff-tree", "--root", "--no-renames", "--no-commit-id", "--name-status", "-z", "-r", ...commit.revisions])));
  const identity = await readIdentity(snapshot, exec);
  if (identity.head !== snapshot.head || identity.branch !== snapshot.branch) throw new Error("Repository HEAD changed. Refresh before enabling Amend.");
  return { head: snapshot.head, message: commit.message, files };
}

export async function readDiff(snapshot, file, exec) {
  if (!validPath(file?.path) || !["staged", "unstaged", "previous"].includes(file.group)) throw new Error("Select a changed file");
  if (file.conflict) return [{ kind: "note", text: "Unresolved conflict. Resolve this file outside Changes, then refresh." }];
  const options = ["--no-ext-diff", "--no-textconv", "--no-color", "--no-renames", "--unified=3"];
  let result;
  if (file.group === "previous") {
    const commit = await previousCommit(snapshot, exec);
    result = await run(exec, snapshot, ["diff-tree", "--root", "--no-commit-id", "-r", "-p", ...options, ...commit.revisions, "--", file.path]);
    checked(result);
  } else if (file.untracked) {
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
  let attempted = false, committed = false;
  try {
    const current = () => { if (!isCurrent()) throw new Error("Focus changed. Return to this repository and refresh before trying again."); };
    current();
    if (snapshot.state !== "ready" || !snapshot.root) throw new Error("Load a repository before changing files");
    const fresh = await readSnapshot({ cwd: snapshot.root, on: snapshot.on }, exec);
    current();
    if (fresh.state !== "ready" || repositoryKey(fresh) !== repositoryKey(snapshot) || fresh.head !== snapshot.head || fresh.branch !== snapshot.branch) {
      throw new Error("Repository HEAD or branch changed. Refresh before trying again.");
    }
    if (fresh.files.some((file) => file.conflict)) throw new Error("Resolve conflicts outside Changes before changing files");
    const paths = [...new Set(action.paths ?? [])];
    if (paths.some((path) => !validPath(path))) throw new Error("Select valid file paths");
    const dirty = fresh.files.filter((file) => paths.includes(file.path));
    const loaded = new Set(snapshot.files.map((file) => file.path));
    if (dirty.some((file) => !loaded.has(file.path))) throw new Error("The selected files changed. Refresh before trying again.");
    let expectedHead = fresh.head;
    const write = async (args) => {
      current();
      const identity = await readIdentity(fresh, exec);
      current();
      if (identity.head !== expectedHead || identity.branch !== fresh.branch) throw new Error("Repository HEAD or branch changed. Refresh before trying again.");
      attempted = true;
      return checked(await run(exec, fresh, args, false));
    };
    if (action.type === "commit") {
      const args = commitArgs(action.message);
      if (!dirty.length && !action.amend) throw new Error("Select changed files before committing");
      if (action.amend && !fresh.head) throw new Error("Create a commit before enabling Amend");
      const untracked = dirty.filter((file) => file.untracked).map((file) => file.path);
      if (untracked.length) await write(["add", "--intent-to-add", "--", ...untracked]);
      await write([...args, "--only", ...(action.amend ? ["--amend"] : []), ...(dirty.length ? ["--", ...dirty.map((file) => file.path)] : [])]);
      committed = true;
      if (action.push) {
        current();
        const identity = await readIdentity(fresh, exec);
        current();
        expectedHead = identity.head;
        if (!expectedHead || identity.branch !== fresh.branch) throw new Error("Repository changed after the local commit");
        // Push the exact commit just created. Never force or retry a rejected push.
        await write(["push"]);
      }
    } else if (action.type === "stash") {
      if (!dirty.length) throw new Error("Select changed files before stashing");
      await write(["stash", "push", "--include-untracked", "--", ...dirty.map((file) => file.path)]);
    } else if (action.type === "rollback") {
      if (action.confirmed !== true) throw new Error("Confirm rollback before discarding selected changes");
      if (!dirty.length) throw new Error("Select changed files before rolling back");
      const selected = dirty.map((file) => file.path);
      const index = checked(await run(exec, fresh, ["ls-files", "--stage", "-z", "--", ...selected]));
      current();
      const tree = fresh.head ? checked(await run(exec, fresh, ["ls-tree", "-z", fresh.head, "--", ...selected])) : "";
      current();
      const entries = (text) => text.split("\0").filter(Boolean).map((record) => {
        const tab = record.indexOf("\t");
        if (tab < 0) throw new Error("Git returned invalid tracked paths");
        return { mode: record.slice(0, 6), path: record.slice(tab + 1) };
      });
      const indexed = entries(index), baseline = entries(tree);
      if ([...indexed, ...baseline].some((entry) => entry.mode === "160000")) throw new Error("Submodule rollback is not supported. Restore the submodule outside Changes.");
      const tracked = baseline.map((entry) => entry.path);
      const additions = selected.filter((path) => !tracked.includes(path));
      const indexedAdditions = additions.filter((path) => indexed.some((entry) => entry.path === path));
      if (tracked.length) await write(["restore", "--source=HEAD", "--staged", "--worktree", "--", ...tracked]);
      if (indexedAdditions.length) await write(["rm", "--cached", "--force", "-q", "--", ...indexedAdditions]);
      // Status enumerates individual untracked files. Never clean a containing directory.
      for (const path of additions) {
        const others = checked(await run(exec, fresh, ["ls-files", "--others", "-z", "--", path])).split("\0").filter(Boolean);
        current();
        if (others.some((entry) => entry !== path)) throw new Error("A selected file is now a directory. Refresh and select individual files before rollback.");
        if (others.length) await write(["clean", "--force", "-x", "--", path]);
      }
    } else throw new Error("Unknown Changes action");
    return { ok: true, attempted, committed };
  } catch (error) {
    const detail = String(error?.message ?? error);
    return { ok: false, attempted, committed, message: committed ? `Local commit succeeded, but push did not complete: ${detail}` : detail };
  }
}
