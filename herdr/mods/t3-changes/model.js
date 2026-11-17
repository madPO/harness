// Calculations only. Git paths remain exact; display escaping never becomes a pathspec.
const CONFLICTS = { DD: true, AU: true, UD: true, UA: true, DU: true, AA: true, UU: true };
const STATES = /^[ MADRCUT?!]{2}$/;
export const displayPath = (path) => path.replace(/[\x00-\x1f\x7f]/g, (c) => c === "\n" ? "\\n" : c === "\t" ? "\\t" : `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
export const contextKey = ({ space, cwd, on }) => JSON.stringify([space ?? null, on ?? null, cwd || null]);
export const repositoryKey = ({ root, on }) => JSON.stringify([on ?? null, root]);

export function validPath(path) {
  return typeof path === "string" && path.length > 0 && !path.includes("\0") && !path.startsWith("/")
    && path.split("/").every((part) => part && part !== "." && part !== "..");
}

export function parseStatus(text) {
  if (!text) return [];
  const records = text.split("\0");
  if (records.pop() !== "") throw new Error("Git returned incomplete NUL-delimited status");
  return records.map((record) => {
    const xy = record.slice(0, 2), path = record.slice(3);
    if (record[2] !== " " || !STATES.test(xy) || !validPath(path) || /[RC]/.test(xy)) {
      throw new Error("Git returned an unsupported status record");
    }
    const conflict = Object.hasOwn(CONFLICTS, xy), untracked = xy === "??";
    return { path, xy, conflict, untracked };
  });
}

const badge = (code) => code === "?" ? "A" : code === "T" ? "M" : code;
export function groupsOf(files) {
  const staged = [], unstaged = [];
  for (const file of files) {
    if (file.conflict) unstaged.push({ ...file, group: "unstaged", status: "U" });
    else if (file.untracked) unstaged.push({ ...file, group: "unstaged", status: "A" });
    else {
      if (file.xy[0] !== " ") staged.push({ ...file, group: "staged", status: badge(file.xy[0]) });
      if (file.xy[1] !== " ") unstaged.push({ ...file, group: "unstaged", status: badge(file.xy[1]) });
    }
  }
  return { staged, unstaged };
}

export function unifiedFiles(snapshot, previous = []) {
  const files = new Map();
  for (const file of [...(snapshot?.groups.unstaged ?? []), ...(snapshot?.groups.staged ?? []), ...previous]) {
    if (!files.has(file.path)) files.set(file.path, file);
  }
  return [...files.values()];
}

export function parsePrevious(text) {
  if (!text) return [];
  const records = text.split("\0");
  if (records.pop() !== "" || records.length % 2) throw new Error("Git returned incomplete previous-commit paths");
  const files = [];
  for (let i = 0; i < records.length; i += 2) {
    const status = records[i], path = records[i + 1];
    if (!/^[AMDT]$/.test(status) || !validPath(path)) throw new Error("Git returned unsupported previous-commit paths");
    files.push({ path, status, xy: "  ", group: "previous", conflict: false, untracked: false });
  }
  return files;
}

export function fileTree(files) {
  const root = { children: new Map() };
  for (const file of files) {
    let node = root, path = "";
    const parts = file.path.split("/");
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i]; path += (path ? "/" : "") + name;
      if (!node.children.has(name)) node.children.set(name, { name, path, children: new Map() });
      node = node.children.get(name);
      if (i === parts.length - 1) node.file = file;
    }
  }
  const ordered = (node) => [...node.children.values()].flatMap((child) => [
    ...(child.children.size ? [{ name: child.name, path: child.path, children: ordered(child) }] : []),
    ...(child.file ? [{ name: child.name, path: child.path, file: child.file }] : []),
  ]).sort((a, b) => Number(Boolean(a.file)) - Number(Boolean(b.file)) || a.name.localeCompare(b.name));
  return ordered(root);
}

export function treeRows(tree, collapsed, group, depth = 0) {
  return tree.flatMap((node) => [{ ...node, depth }, ...(!node.file && !collapsed.has(`${group}:${node.path}`) ? treeRows(node.children, collapsed, group, depth + 1) : [])]);
}

export function commitArgs(message) {
  if (typeof message !== "string" || !message.trim()) throw new Error("Enter a commit message");
  if (message.includes("\0")) throw new Error("Commit messages can't contain NUL characters");
  return ["commit", "--cleanup=verbatim", "-m", message];
}
