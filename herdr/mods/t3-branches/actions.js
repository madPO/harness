import { READ } from "./git.js";

const oid = (value) => typeof value === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value);
const errorText = (result) => (result.stderr || result.stdout || `Git exited with code ${result.code}`).trim();
const stale = () => new Error("The repository, HEAD, or selected branch changed. Refresh Branches and review the action again.");
const git = (exec, snapshot, args) => exec("git", [...READ, ...args], { cwd: snapshot.root, on: snapshot.on ?? null });
async function checked(exec, snapshot, args) {
  const result = await git(exec, snapshot, args);
  if (result.code !== 0) throw new Error(errorText(result));
  return result.stdout;
}
function validSnapshot(snapshot) {
  if (snapshot?.state !== "ready" || typeof snapshot.root !== "string" || !snapshot.root || snapshot.root.includes("\0")
    || (snapshot.on != null && (typeof snapshot.on !== "string" || !snapshot.on || snapshot.on.includes("\0")))) {
    throw new Error("The repository isn't ready. Refresh Branches before choosing an action.");
  }
}
function validBranch(branch) {
  const prefix = branch?.kind === "local" ? "refs/heads/" : branch?.kind === "remote" ? "refs/remotes/" : null;
  if (!prefix || typeof branch.name !== "string" || !branch.name || branch.ref !== prefix + branch.name) {
    throw new Error("The selected branch isn't valid. Refresh Branches and select it again.");
  }
}
async function readState(snapshot, branch, exec) {
  const top = await checked(exec, snapshot, ["rev-parse", "--show-toplevel"]);
  if (top.replace(/\r?\n$/, "") !== snapshot.root) throw stale();
  await checked(exec, snapshot, ["check-ref-format", branch.ref]);
  const selected = await checked(exec, snapshot, ["show-ref", "--verify", "--hash", branch.ref]);
  const target = selected.trim();
  if (!oid(target)) throw new Error("Git returned an invalid selected branch tip. Refresh Branches.");
  const headResult = await git(exec, snapshot, ["rev-parse", "--verify", "--quiet", "HEAD"]);
  const currentResult = await git(exec, snapshot, ["symbolic-ref", "--quiet", "HEAD"]);
  if (![0, 1].includes(headResult.code)) throw new Error(errorText(headResult));
  const commit = await checked(exec, snapshot, ["rev-parse", "--verify", `${target}^{commit}`]);
  if (commit.trim() !== target) throw new Error("The selected branch doesn't point directly to a commit. Refresh Branches.");
  if (![0, 1].includes(currentResult.code)) throw new Error(errorText(currentResult));
  const head = headResult.code === 0 ? headResult.stdout.trim() : null;
  const currentRef = currentResult.code === 0 ? currentResult.stdout.trim() : null;
  if ((head !== null && !oid(head)) || (currentRef !== null && !currentRef.startsWith("refs/heads/"))) {
    throw new Error("Git returned an invalid HEAD. Refresh Branches before continuing.");
  }
  return { head, current: currentRef?.slice("refs/heads/".length) ?? null, target };
}
async function readRemote(snapshot, branch, exec) {
  if (branch.kind !== "remote") return { remote: null, remoteBranch: null, localExists: false };
  const remotes = (await checked(exec, snapshot, ["remote"])).split(/\r?\n/).filter(Boolean);
  const remote = remotes.filter((name) => branch.name.startsWith(`${name}/`)).sort((a, b) => b.length - a.length)[0] ?? null;
  if (!remote) return { remote: null, remoteBranch: null, localExists: false };
  const remoteBranch = branch.name.slice(remote.length + 1);
  const local = await git(exec, snapshot, ["show-ref", "--verify", "--quiet", `refs/heads/${remoteBranch}`]);
  if (![0, 1].includes(local.code)) throw new Error(errorText(local));
  return { remote, remoteBranch, localExists: local.code === 0 };
}

export async function readActionContext(snapshot, branch, exec) {
  validSnapshot(snapshot);
  validBranch(branch);
  const capturedSnapshot = { ...snapshot, branches: snapshot.branches.map((item) => ({ ...item })) };
  const capturedBranch = { ...branch };
  const state = await readState(capturedSnapshot, capturedBranch, exec);
  const remote = await readRemote(capturedSnapshot, capturedBranch, exec);
  return { snapshot: capturedSnapshot, branch: capturedBranch, ...state, ...remote };
}

export function actionItems(ctx, pinned) {
  const selected = ctx.branch.name;
  const current = ctx.current;
  const isCurrent = ctx.branch.kind === "local" && selected === current;
  const items = [];
  if (ctx.head && ctx.target) {
    if (!isCurrent && (ctx.branch.kind === "local" || ctx.remote)) items.push({ type: "checkout", label: `Checkout ${selected}` });
    if (!isCurrent && current) {
      items.push({ type: "merge", label: `Merge ${selected} into ${current}` },
        { type: "rebase", label: `Rebase ${current} onto ${selected}` },
        { type: "interactiveRebase", label: `Interactive rebase ${current} onto ${selected}` });
    }
    items.push({ type: "createBranch", label: `New branch from ${selected}` }, { type: "addTag", label: `New tag at ${selected}` });
    if (!isCurrent && (ctx.branch.kind === "local" || ctx.remote)) {
      items.push({ type: "deleteBranch", label: `Delete ${selected}`, danger: true });
    }
  }
  items.push({ type: "copy", label: "Copy branch name" }, { type: "pin", label: `${pinned ? "Unpin" : "Pin"} ${selected}` });
  return items;
}

function validContext(ctx) {
  if (!ctx || typeof ctx !== "object") throw stale();
  validSnapshot(ctx.snapshot);
  validBranch(ctx.branch);
  const nullableName = (value) => value === null || (typeof value === "string" && value.length > 0 && !value.includes("\0"));
  if ((ctx.head !== null && !oid(ctx.head)) || !oid(ctx.target) || !nullableName(ctx.current)
    || !nullableName(ctx.remote) || !nullableName(ctx.remoteBranch) || typeof ctx.localExists !== "boolean"
    || (ctx.remote === null) !== (ctx.remoteBranch === null)
    || (ctx.branch.kind === "local" && (ctx.remote !== null || ctx.remoteBranch !== null || ctx.localExists))) {
    throw new Error("The captured action context isn't valid. Refresh Branches and choose the action again.");
  }
}
async function verifyContext(ctx, exec) {
  validContext(ctx);
  const actual = await readState(ctx.snapshot, ctx.branch, exec);
  if (actual.head !== ctx.head || actual.current !== ctx.current || actual.target !== ctx.target) throw stale();
  if (ctx.branch.kind === "remote") {
    const remote = await readRemote(ctx.snapshot, ctx.branch, exec);
    if (remote.remote !== ctx.remote || remote.remoteBranch !== ctx.remoteBranch) throw stale();
  }
}
async function readHistory(ctx, exec) {
  const text = await checked(exec, ctx.snapshot, ["log", "--reverse", "--topo-order", "--format=%H%x00%P%x00%s", `${ctx.target}..${ctx.head}`]);
  if (!text.trim()) throw new Error("There are no current-branch commits to rebase onto the selected branch.");
  return text.trimEnd().split("\n").map((line) => {
    const [hash, parents, subject, ...extra] = line.split("\0");
    if (!oid(hash) || parents.split(" ").filter(Boolean).some((parent) => !oid(parent)) || subject === undefined || extra.length) {
      throw new Error("Git returned an invalid rebase history. Refresh Branches before trying again.");
    }
    if (parents.split(" ").filter(Boolean).length > 1) {
      throw new Error("Interactive rebase doesn't support merge commits. Choose a linear history or use plain rebase.");
    }
    return { hash, parents, subject: subject.replace(/[\x00-\x1f\x7f]/g, " ") };
  });
}
export async function readRebaseTodo(ctx, exec) {
  await verifyContext(ctx, exec);
  if (!actionItems(ctx, false).some((item) => item.type === "interactiveRebase")) {
    throw new Error("Interactive rebase needs a current branch and a different selected branch.");
  }
  const history = await readHistory(ctx, exec);
  ctx.rebaseHistory = JSON.stringify(history);
  return history.map(({ hash, subject }) => `pick ${hash} ${subject}`).join("\n") + "\n";
}
function validateTodo(todo, history) {
  if (typeof todo !== "string" || todo.includes("\0") || /[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(todo)) {
    throw new Error("Enter a rebase todo using pick, drop, squash, or fixup and full commit IDs.");
  }
  const eligible = new Set(history.map(({ hash }) => hash));
  const seen = new Set();
  const lines = [];
  let picked = false;
  for (const line of todo.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = /^(pick|drop|squash|fixup)\s+([0-9a-f]+)(?:[ \t]+[^\r\n]*)?$/.exec(line.trim());
    if (!match || !eligible.has(match[2]) || seen.has(match[2])) {
      throw new Error("The rebase todo contains an unsafe command, unknown commit, or duplicate commit. Use each captured commit once.");
    }
    const [, command, hash] = match;
    if ((command === "squash" || command === "fixup") && !picked) {
      throw new Error("The first retained commit must use pick before squash or fixup.");
    }
    if (command === "pick") picked = true;
    seen.add(hash);
    // Strip editable descriptions. Only validated commands and object IDs reach the editor.
    lines.push(`${command} ${hash}`);
  }
  if (seen.size !== eligible.size) throw new Error("The rebase todo must include every captured commit. Use drop to remove a commit.");
  return lines.join("\n") + "\n";
}
const shellQuote = (value) => `'${value.replace(/'/g, `'\\''`)}'`;
async function validName(name, kind, ctx, exec) {
  if (typeof name !== "string" || !name || name.startsWith("-") || name.includes("\0")
    || name !== name.trim() || (kind === "heads" && name === "HEAD")) {
    throw new Error(`Enter a valid ${kind === "heads" ? "branch" : "tag"} name that doesn't start with '-'.`);
  }
  await checked(exec, ctx.snapshot, ["check-ref-format", `refs/${kind}/${name}`]);
  return name;
}
function validateValues(type, values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("The action values aren't valid.");
  const allowed = type === "checkout" || type === "createBranch" ? ["name"] : type === "addTag" ? ["name", "message"]
    : type === "deleteBranch" ? ["force"] : type === "interactiveRebase" ? ["todo"] : [];
  if (Object.keys(values).some((key) => !allowed.includes(key)) || (values.force !== undefined && typeof values.force !== "boolean")
    || (values.message !== undefined && (typeof values.message !== "string" || values.message.includes("\0")))) {
    throw new Error("The action contains unsupported values. Close the action and try again.");
  }
}
export async function executeBranchAction(type, values, ctx, exec) {
  validateValues(type, values);
  validContext(ctx);
  if (type === "copy" || type === "pin" || !actionItems(ctx, false).some((item) => item.type === type)) {
    throw new Error("This action isn't available for the selected branch. Refresh Branches and choose another action.");
  }
  await verifyContext(ctx, exec);
  let args;
  let sequenceEditor = null;
  if (type === "checkout") {
    if (ctx.branch.kind === "local") {
      if (values.name !== undefined) throw new Error("Local checkout doesn't accept a different branch name.");
      args = ["switch", "--no-guess", "--", ctx.branch.name];
    } else {
      const name = await validName(values.name ?? ctx.remoteBranch, "heads", ctx, exec);
      args = ["switch", "--no-guess", "--track", "-c", name, "--", ctx.branch.ref];
    }
  } else if (type === "createBranch") {
    args = ["branch", "--", await validName(values.name, "heads", ctx, exec), ctx.target];
  } else if (type === "addTag") {
    const name = await validName(values.name, "tags", ctx, exec);
    args = values.message ? ["-c", "tag.gpgSign=false", "tag", "-a", "-m", values.message, "--", name, ctx.target]
      : ["-c", "tag.gpgSign=false", "tag", "--", name, ctx.target];
  } else if (type === "merge") {
    args = ["-c", "core.editor=true", "merge", "--no-edit", "--", ctx.target];
  } else if (type === "rebase") {
    args = ["-c", "core.editor=true", "rebase", "--no-autostash", "--no-update-refs", "--", ctx.target];
  } else if (type === "interactiveRebase") {
    if (typeof ctx.rebaseHistory !== "string") throw new Error("Open the interactive rebase todo before confirming the rebase.");
    const history = await readHistory(ctx, exec);
    if (JSON.stringify(history) !== ctx.rebaseHistory) throw stale();
    const todo = validateTodo(values.todo, history);
    sequenceEditor = `sh -c ${shellQuote(`printf '%s' ${shellQuote(todo)} > "$1"`)} sh`;
    args = ["-c", "core.editor=true", "rebase", "--interactive", "--no-rebase-merges",
      "--no-autosquash", "--no-autostash", "--no-update-refs", "--no-fork-point", "--reapply-cherry-picks", "--empty=keep", "--", ctx.target];
  } else if (type === "deleteBranch") {
    if (ctx.branch.kind === "local") args = ["branch", values.force ? "-D" : "-d", "--", ctx.branch.name];
    else {
      if (ctx.remote.startsWith("-") || /[\x00-\x20\x7f]/.test(ctx.remote)) throw new Error("The configured remote name isn't safe for deletion.");
      args = ["push", `--force-with-lease=refs/heads/${ctx.remoteBranch}:${ctx.target}`, "--", ctx.remote, `:refs/heads/${ctx.remoteBranch}`];
    }
  }
  // Git cannot lock out other terminals across preflight and execution. Recheck after validation reads.
  await verifyContext(ctx, exec);
  const result = sequenceEditor === null ? await git(exec, ctx.snapshot, args)
    : await exec("env", [`GIT_SEQUENCE_EDITOR=${sequenceEditor}`, "GIT_EDITOR=true", "git", ...READ, ...args],
      { cwd: ctx.snapshot.root, on: ctx.snapshot.on ?? null });
  if (result.code !== 0) throw new Error(errorText(result));
}
