const HOST_OUTPUT_LIMIT = 8 * 1024 * 1024;
const INVENTORY_LIMIT = 256 * 1024;
const MAX_FILES = 256;
const MAX_DIRTY_PATHS = 2 * MAX_FILES;
const MAX_UNTRACKED = 64;
const UNTRACKED_PATCH_LIMIT = 384 * 1024;
const PATCH_LIMIT = 2 * 1024 * 1024;
const PREVIEW_LIMIT = 48 * 1024;
const TIMEOUT = 15_000;
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

const READ = [
  "--no-pager", "--no-optional-locks", "--no-lazy-fetch", "--no-replace-objects", "--literal-pathspecs",
  "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false", "-c", "core.quotePath=true",
  "-c", "core.safecrlf=false",
];
const DIFF = [
  "--no-ext-diff", "--no-textconv", "--no-color", "--no-relative", "--ignore-submodules=dirty", "--submodule=short",
];
const PATCH = [
  "--patch", "--binary", "--full-index", "--unified=3", "--inter-hunk-context=0", "--diff-algorithm=myers",
  "--src-prefix=a/", "--dst-prefix=b/", "--output-indicator-new=+", "--output-indicator-old=-", "--output-indicator-context= ",
];
const STAGED = "Staged changes (HEAD to index)";
const UNSTAGED = "Unstaged changes (index to working tree)";
const UNTRACKED = "Untracked additions";

export function validPath(path) {
  return typeof path === "string" && path.length > 0 && !path.startsWith("/")
    && !/[\0\uFFFD\uD800-\uDFFF]/u.test(path) && !/^(?:[A-Za-z]:[\\/]|\\)/.test(path)
    && path.split("/").every(Boolean) && path.split(/[\\/]/).every((part) => part !== "." && part !== "..");
}

function utf8Size(text) {
  let size = 0;
  for (const character of text) {
    const code = character.codePointAt(0);
    size += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return size;
}

function overBudget(label) {
  return new Error(`${label} exceeds the review limit. Review a smaller scope or inspect the changes in a terminal.`);
}

// Callers select a read-only Git command and handle that command's exit codes.
export async function gitRead(exec, context, args) {
  const cwd = context.root ?? context.cwd;
  if (!cwd) throw new Error("Open a folder inside a Git working tree.");
  // check-ignore rejects literal pathspec magic; its caller supplies safe ./-prefixed paths.
  const options = args[0] === "check-ignore" ? READ.filter((option) => option !== "--literal-pathspecs") : READ;
  const result = await exec("git", [...options, ...args], { cwd, on: context.on ?? null, timeout: TIMEOUT });
  if (result.code !== 0 && result.stderr.includes("unknown option: --no-lazy-fetch")) {
    throw new Error("Review Assistant requires Git 2.45 or newer. Upgrade Git on the selected machine.");
  }
  if (utf8Size(result.stdout) + utf8Size(result.stderr) >= HOST_OUTPUT_LIMIT) throw overBudget("Git output");
  return result;
}

function checked(result, limit, label, diff = false) {
  if (result.code !== 0 && !(diff && result.code === 1 && !result.stderr)) {
    throw new Error(result.stderr.trim() || `Git exited with code ${result.code}. Inspect the repository in a terminal.`);
  }
  if (utf8Size(result.stdout) >= limit) throw overBudget(label);
  return result.stdout;
}

function oneLine(text) {
  if (!text.endsWith("\n")) throw new Error("Git returned incomplete repository information. Inspect the repository in a terminal.");
  return text.slice(0, -1);
}

function objectId(text) {
  const id = oneLine(text);
  if (!OID.test(id)) throw new Error("Git returned an invalid commit ID. Inspect the repository in a terminal.");
  return id;
}

function records(text) {
  if (!text) return [];
  const entries = text.split("\0");
  if (entries.pop() !== "") throw new Error("Git returned an incomplete file inventory. Inspect the repository in a terminal.");
  return entries;
}

function gitPath(path) {
  if (!validPath(path)) throw new Error("Git listed a path Review Assistant cannot read safely. Inspect the changes in a terminal.");
  return path;
}

function parseNameStatus(text) {
  const entries = records(text), files = [];
  for (let i = 0; i < entries.length;) {
    const code = entries[i++];
    if (/^[RC]\d{1,3}$/.test(code)) {
      const oldPath = gitPath(entries[i++]), path = gitPath(entries[i++]);
      files.push({ path, status: code[0], oldPath });
    } else if (/^[ADMTUXB]$/.test(code)) {
      files.push({ path: gitPath(entries[i++]), status: code });
    } else throw new Error("Git returned an unsupported file status. Inspect the changes in a terminal.");
    if (files.length > MAX_FILES) throw overBudget("Changed file inventory");
  }
  return files;
}

function localPaths(text) {
  const dirty = new Set();
  // Renames are disabled for status, so both old and new names get their own record.
  for (const record of records(text)) {
    if (!/^[ MADTUC?!]{2} /.test(record)) throw new Error("Git returned an unsupported local status. Inspect the repository in a terminal.");
    dirty.add(gitPath(record.slice(3)));
    if (dirty.size > MAX_DIRTY_PATHS) throw overBudget("Local file inventory");
  }
  return [...dirty].sort();
}

function inventoryOf(staged, unstaged, untracked) {
  const files = new Map(), dirty = new Set();
  for (const list of [staged, unstaged, untracked]) {
    for (const file of list) {
      const previous = files.get(file.path);
      if (!previous || (!previous.oldPath && file.oldPath)) files.set(file.path, file);
      dirty.add(file.path);
      if (file.oldPath) dirty.add(file.oldPath);
    }
  }
  if (files.size > MAX_FILES) throw overBudget("Changed file inventory");
  if (dirty.size > MAX_DIRTY_PATHS) throw overBudget("Local file inventory");
  return { files: [...files.keys()].sort().map((path) => files.get(path)), dirtyPaths: [...dirty].sort() };
}

function diffArgs(revisions, output, paths = []) {
  return ["diff", ...DIFF, "--find-renames=50%", `-l${MAX_FILES}`, "--ita-invisible-in-index", ...output, ...revisions, "--", ...paths];
}

function patchSection(title, text) {
  return text ? `${title}\n\n${text}` : "";
}

function combinePatches(sections) {
  const patch = sections.filter(Boolean).join("\n");
  if (utf8Size(patch) >= PATCH_LIMIT) throw overBudget("Combined Git patch");
  return patch;
}

function boundedPreview(text) {
  if (text.length <= PREVIEW_LIMIT) return text;
  const prefix = text.slice(0, PREVIEW_LIMIT).replace(/[\uD800-\uDBFF]$/, "");
  return `${prefix}\n\nPreview limited to ${PREVIEW_LIMIT / 1024} Ki characters. Inspect the complete diff in a terminal.`;
}

const LOCAL_REF = "refs/heads/";
const REMOTE_REF = "refs/remotes/";
const localBranchRequired = () => new Error("Check out a local branch before pressing Compare.");

async function readCurrentBranch(read) {
  const result = await read(["symbolic-ref", "--quiet", "HEAD"]);
  if (result.code === 1 && !result.stdout && !result.stderr) return null;
  const ref = oneLine(checked(result, INVENTORY_LIMIT, "Git source branch"));
  if (!ref.startsWith(LOCAL_REF) || ref.length === LOCAL_REF.length) throw localBranchRequired();
  return ref;
}

const compareNames = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function branchOptions(text) {
  if (!text) return [];
  if (!text.endsWith("\n")) throw new Error("Git returned an incomplete branch inventory.");
  const branches = [];
  for (const line of text.slice(0, -1).split("\n")) {
    const [ref, symref, extra] = line.split("\0");
    const prefix = ref.startsWith(LOCAL_REF) ? LOCAL_REF : ref.startsWith(REMOTE_REF) ? REMOTE_REF : null;
    if (!prefix || ref.length === prefix.length || symref === undefined || extra !== undefined) {
      throw new Error("Git returned an invalid branch record.");
    }
    if (!symref) branches.push({ ref, label: ref.slice(prefix.length) });
  }
  return branches.sort((a, b) => compareNames(a.label, b.label) || compareNames(a.ref, b.ref));
}

async function readHead(read) {
  const result = await read(["rev-parse", "--verify", "--quiet", "--end-of-options", "HEAD^{commit}"]);
  if (result.code !== 1 || result.stderr) return objectId(checked(result, INVENTORY_LIMIT, "Git HEAD"));
  const ref = oneLine(checked(await read(["symbolic-ref", "--quiet", "HEAD"]), INVENTORY_LIMIT, "Git HEAD"));
  const exists = await read(["show-ref", "--exists", ref]);
  if (exists.code === 2) return null;
  throw new Error("Git could not resolve HEAD as a commit. Inspect the repository in a terminal.");
}

function refCandidates(target) {
  if (target.startsWith(LOCAL_REF) || target.startsWith(REMOTE_REF)) return [target];
  if (target.startsWith("refs/")) return [];
  return [`${LOCAL_REF}${target}`, `${REMOTE_REF}${target}`];
}

async function readTarget(read, target) {
  for (const ref of refCandidates(target)) {
    const format = await read(["check-ref-format", ref]);
    if (format.code === 1 && !format.stderr) continue;
    checked(format, INVENTORY_LIMIT, "Git branch name");
    const exists = await read(["show-ref", "--exists", ref]);
    if (exists.code === 2) continue;
    checked(exists, INVENTORY_LIMIT, "Git branch lookup");
    const id = objectId(checked(await read(["show-ref", "--verify", "--hash", "--", ref]), INVENTORY_LIMIT, "Git branch lookup"));
    const commit = await read(["rev-parse", "--verify", "--end-of-options", `${id}^{commit}`]);
    if (objectId(checked(commit, INVENTORY_LIMIT, "Git branch commit")) === id) return { ref, id };
    throw new Error("The selected branch does not point directly to a commit. Choose another branch and press Compare.");
  }
  throw new Error("Choose an existing local or remote-tracking branch, then press Compare.");
}

async function filterOverrides(read) {
  // Diff and status may otherwise run a clean/process filter when inspecting files on disk.
  const result = await read(["config", "--null", "--name-only", "--get-regexp", "^filter\\..*\\.(clean|process|required)$"]);
  if (result.code === 1 && !result.stdout && !result.stderr) return [];
  const names = new Set();
  for (const key of records(checked(result, 4096, "Git filter configuration"))) {
    if (/[=\uFFFD]/.test(key)) throw new Error("Git has a filter Review Assistant cannot disable safely. Inspect the repository in a terminal.");
    names.add(key.slice(0, key.lastIndexOf(".")));
  }
  return [...names].flatMap((name) => ["-c", `${name}.clean=`, "-c", `${name}.process=`, "-c", `${name}.required=false`]);
}

async function names(read, revisions, paths) {
  return parseNameStatus(checked(await read(diffArgs(revisions, ["--name-status", "-z"], paths)), INVENTORY_LIMIT, "Changed file inventory"));
}

async function untrackedPaths(read, paths = []) {
  const text = checked(await read(["ls-files", "--others", "--exclude-standard", "-z", "--", ...paths]), INVENTORY_LIMIT, "Untracked file inventory");
  const entries = records(text);
  if (entries.length > MAX_UNTRACKED) throw overBudget("Untracked file count");
  return entries.map(gitPath);
}

async function diffPatch(read, revisions, paths) {
  return checked(await read(diffArgs(revisions, PATCH, paths)), PATCH_LIMIT, "Git patch");
}

async function untrackedPatch(read, paths) {
  let text = "", size = 0;
  for (const path of paths) {
    const operand = path === "-" ? "./-" : path;
    const result = await read(["diff", "--no-index", ...DIFF, ...PATCH, "--no-renames", "--", "/dev/null", operand]);
    const patch = checked(result, UNTRACKED_PATCH_LIMIT, `Patch for untracked file ${JSON.stringify(path)}`, true);
    if (!patch) throw new Error("An untracked file changed while reading. Try again.");
    size += utf8Size(patch);
    if (size >= PATCH_LIMIT) throw overBudget("Combined untracked patch");
    text += patch;
  }
  return text;
}

const indexDiff = (head) => head ? ["--cached", head] : ["--cached"];

async function readWorktree(read, head) {
  const index = indexDiff(head);
  const staged = await names(read, index), unstaged = await names(read, []);
  if ([staged, unstaged].some((files) => files.some((file) => file.status === "U"))) {
    throw new Error("Resolve merge conflicts or press Compare to review committed branch changes.");
  }
  const additions = await untrackedPaths(read);
  const inventory = inventoryOf(staged, unstaged, additions.map((path) => ({ path, status: "A" })));
  const stagedPatch = staged.length ? await diffPatch(read, index) : "";
  const unstagedPatch = unstaged.length ? await diffPatch(read, []) : "";
  const patch = combinePatches([
    patchSection(STAGED, stagedPatch), patchSection(UNSTAGED, unstagedPatch),
    patchSection(UNTRACKED, await untrackedPatch(read, additions)),
  ]);
  return { ...inventory, patch };
}

const withCommitAttributes = (read, head) => (args) => read([`--attr-source=${head}`, ...args]);

async function readBranch(read, readLocal, head, target) {
  const ancestor = await read(["merge-base", head, target.id]);
  if (ancestor.code === 1 && !ancestor.stderr) throw new Error("The target branch has no merge base with HEAD. Choose another branch and press Compare.");
  const base = objectId(checked(ancestor, INVENTORY_LIMIT, "Git merge base"));
  const revisions = [base, head];
  const readCommitted = withCommitAttributes(read, head);
  const files = await names(readCommitted, revisions);
  const patch = files.length ? await diffPatch(readCommitted, revisions) : "";
  const status = await readLocal(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all", "--ignore-submodules=dirty"]);
  return { base, files, patch, dirtyPaths: localPaths(checked(status, INVENTORY_LIMIT, "Local file inventory")) };
}

function requestedScope(scope) {
  if (scope?.kind === "worktree") return { kind: "worktree" };
  if (scope?.kind === "branch" && typeof scope.target === "string" && scope.target.length > 0
    && scope.target.length <= 1024 && !scope.target.includes("\0")) return { kind: "branch", target: scope.target };
  throw new Error("Choose an existing local or remote-tracking branch, then press Compare.");
}

const headChanged = (comparing = false) => new Error(comparing
  ? "Git HEAD changed while reading. Press Compare to try again."
  : "Git HEAD changed while reading. Try again.");

async function readRepository(exec, location) {
  const top = await gitRead(exec, location, ["rev-parse", "--show-toplevel"]);
  if (top.code !== 0) {
    const detail = top.stderr.trim();
    throw new Error(`Open a folder inside a Git working tree.${detail ? `\n${detail}` : ""}`);
  }
  const root = oneLine(checked(top, INVENTORY_LIMIT, "Git working tree path")), on = location.on ?? null;
  if (!root || /[\0\uFFFD]/.test(root)) throw new Error("Git returned an unreadable working tree path. Open another repository.");
  return { root, on };
}

export async function readBranches(exec, location) {
  const repository = await readRepository(exec, location);
  const read = (args) => gitRead(exec, repository, args);
  const current = await readCurrentBranch(read);
  const refs = await read(["for-each-ref", "--format=%(refname)%00%(symref)", "refs/heads", "refs/remotes"]);
  return { current, branches: branchOptions(checked(refs, INVENTORY_LIMIT, "Git branch inventory")) };
}

export async function readSnapshot(exec, location, requested) {
  const scope = requestedScope(requested);
  const repository = await readRepository(exec, location);
  const { root, on } = repository;
  const read = (args) => gitRead(exec, repository, args);
  const comparing = scope.kind === "branch";
  const sourceRef = comparing ? await readCurrentBranch(read) : null;
  if (comparing && !sourceRef) throw localBranchRequired();
  const head = await readHead(read);
  if (comparing && !head) throw new Error("Create a commit on the checked-out branch before pressing Compare.");
  const target = comparing ? await readTarget(read, scope.target) : null;
  const overrides = await filterOverrides(read);
  const readLocal = (args) => read([...overrides, ...args]);
  const { base = head, files, patch, dirtyPaths } = target
    ? await readBranch(read, readLocal, head, target)
    : await readWorktree(readLocal, head);
  if (target) {
    const after = await readTarget(read, scope.target);
    if (after.ref !== target.ref || after.id !== target.id) {
      throw new Error("The comparison branch changed while reading. Press Compare to try again.");
    }
  }
  if (await readHead(read) !== head) throw headChanged(comparing);
  if (comparing && await readCurrentBranch(read) !== sourceRef) {
    throw new Error("The checked-out branch changed while reading. Press Compare to try again.");
  }
  // Keep an exact equality token without relying on host crypto or lossy patch summaries.
  const revision = JSON.stringify([root, on, head, base, scope, sourceRef, target, files, patch, dirtyPaths]);
  return { root, on, head, base, scope, files, patch, dirtyPaths, revision };
}

export async function readFileDiff(exec, snapshot, path) {
  if (!validPath(path)) throw new Error("Select a valid changed file to view its diff.");
  const file = snapshot.files.find((entry) => entry.path === path);
  if (!file || (file.oldPath !== undefined && !validPath(file.oldPath))) {
    throw new Error("The file is not in this review snapshot. Press Compare to update the file list.");
  }
  const { scope, head, base } = snapshot;
  if ((head !== null && !OID.test(head)) || (scope.kind === "branch" && (!OID.test(base) || !OID.test(head)))) {
    throw new Error("The review snapshot has invalid commits. Press Compare to update the comparison.");
  }
  const read = (args) => gitRead(exec, snapshot, args);
  const paths = file.oldPath ? [file.oldPath, path] : [path];
  if (await readHead(read) !== head) throw headChanged();
  let text;
  if (scope.kind === "branch") {
    text = await diffPatch(withCommitAttributes(read, head), [base, head], paths);
  } else {
    const overrides = await filterOverrides(read);
    const readLocal = (args) => read([...overrides, ...args]);
    const additions = (await untrackedPaths(readLocal, paths)).filter((added) => paths.includes(added));
    text = combinePatches([
      patchSection(STAGED, await diffPatch(readLocal, indexDiff(head), paths)),
      patchSection(UNSTAGED, await diffPatch(readLocal, [], paths)),
      patchSection(UNTRACKED, await untrackedPatch(readLocal, additions)),
    ]);
  }
  if (await readHead(read) !== head) throw headChanged();
  if (!text) throw new Error("The selected diff is no longer available. Press Compare to update the file list.");
  return { title: file.oldPath ? `${file.oldPath} → ${path}` : path, text: boundedPreview(text) };
}
