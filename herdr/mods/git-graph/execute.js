// Action execution is separate from the UI so context checks can be tested
// against disposable repositories. exec has Herdr's (program, argv, options) shape.
import { READ, commandsFor, gitError } from "./git.js";

// Capture the actual push endpoint and its advertised branch tip, not a
// remote-tracking ref that a background fetch can change.
export async function prepareForcePush(action, values, ctx, exec) {
  const git = (args) => exec("git", args, { cwd: ctx.root, on: ctx.on });
  if (action.type !== "push" || !ctx.remotes?.includes(values.remote)) throw new Error("Pick a remote.");
  commandsFor(action, { ...values, force: false }, ctx);
  const ref = `refs/heads/${action.name}`;
  const local = await git([...READ, "rev-parse", "--verify", ref]);
  const urls = await git([...READ, "remote", "get-url", "--push", "--all", values.remote]);
  const endpoints = urls.stdout.trim().split("\n").filter(Boolean);
  if (local.code !== 0 || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(local.stdout.trim())) throw new Error("Can't read the selected branch.");
  if (urls.code !== 0 || endpoints.length !== 1) throw new Error("Force push requires exactly one available push URL.");
  const remote = await git([...READ, "ls-remote", "--refs", "--", endpoints[0], ref]);
  const match = /^([0-9a-f]{40}|[0-9a-f]{64})\t([^\n]+)\n?$/.exec(remote.stdout);
  if (remote.code !== 0 || !match || match[2] !== ref) throw new Error(remote.code ? gitError(remote) : "Can't read the remote branch tip. Force push cancelled.");
  return { branch: action.name, remote: values.remote, head: local.stdout.trim(), remoteHead: match[1], url: endpoints[0] };
}


export async function executeAction(action, values, ctx, exec) {
  const git = (args) => exec("git", args, { cwd: ctx.root, on: ctx.on });
  const commands = commandsFor(action, values, ctx);
  // A dialog/menu describes this snapshot, not whatever HEAD happens to be
  // when the user confirms it. Fetch does not operate on the current branch.
  if (action.type !== "fetch") {
    const head = await git([...READ, "rev-parse", "--verify", "-q", "HEAD"]);
    const branch = await git([...READ, "symbolic-ref", "-q", "--short", "HEAD"]);
    // Exit 1 means unborn HEAD or detached HEAD, respectively. Other failures
    // are not empty states and must not authorize a mutation.
    if (![0, 1].includes(head.code) || ![0, 1].includes(branch.code)) {
      return { ok: false, message: "Cannot verify the repository state. Close this action and refresh the graph." };
    }
    const actualHead = head.code === 0 ? head.stdout.trim() : null;
    const actualBranch = branch.code === 0 ? branch.stdout.trim() : null;
    if (actualHead !== ctx.head || actualBranch !== ctx.current) {
      return { ok: false, stale: true, message: "The repository's branch or HEAD changed. Close this action, refresh the graph, and review it again." };
    }
  }
  if (action.type === "push" && values.force) {
    const lease = values.lease;
    const local = await git([...READ, "rev-parse", "--verify", `refs/heads/${action.name}`]);
    const urls = await git([...READ, "remote", "get-url", "--push", "--all", values.remote]);
    if (local.code !== 0 || local.stdout.trim() !== lease.head || urls.code !== 0 || urls.stdout.trim() !== lease.url) {
      return { ok: false, stale: true, message: "The branch or remote changed. Close this action and confirm again." };
    }
  }
  // Staging everything would mark unresolved conflicts resolved and commit their markers.
  if (action.type === "commit" && values.all) {
    const unmerged = await git([...READ, "ls-files", "--unmerged"]);
    if (unmerged.code !== 0 || unmerged.stdout.trim()) {
      return { ok: false, message: "There are unresolved merge conflicts. Resolve them first, or untick \"Stage every change\" to let git decide." };
    }
  }
  // Git has no transaction spanning these commands and other terminals. This
  // preflight detects an already changed context; it cannot lock out future edits.
  for (const args of commands) {
    const result = await git(args);
    if (result.code !== 0) return { ok: false, message: gitError(result) };
  }
  if (action.type === "push" && values.force && values.upstream) {
    const upstream = await git(["branch", `--set-upstream-to=${values.remote}/${action.name}`, "--", action.name]);
    if (upstream.code !== 0) return { ok: false, message: `Push succeeded, but setting upstream failed: ${gitError(upstream)}` };
  }
  return { ok: true };
}
