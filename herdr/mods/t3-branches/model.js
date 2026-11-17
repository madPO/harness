export const contextKey = ({ space, cwd, on }) => JSON.stringify([space ?? null, on ?? null, cwd || null]);
export const repositoryKey = ({ root, on }) => JSON.stringify([on ?? null, root ?? null]);

// Git forbids newlines and NUL in refs, so records and fields cannot collide.
export function parseRefs(text) {
  if (!text) return [];
  if (!text.endsWith("\n")) throw new Error("Git returned an incomplete branch record");
  return text.slice(0, -1).split("\n").flatMap((line) => {
    const fields = line.split("\0");
    if (fields.length !== 3 || !["*", " "].includes(fields[2])) throw new Error("Git returned an invalid branch record");
    const [ref, symref, head] = fields;
    const kind = ref.startsWith("refs/heads/") ? "local" : ref.startsWith("refs/remotes/") ? "remote" : null;
    if (!kind) throw new Error("Git returned an unexpected branch ref");
    const name = ref.slice(kind === "local" ? "refs/heads/".length : "refs/remotes/".length);
    if (!name || name.split("/").some((part) => !part)) throw new Error("Git returned an invalid branch name");
    if (kind === "remote" && symref && name.endsWith("/HEAD")) return [];
    return [{ ref, name, kind, current: kind === "local" && head === "*" }];
  });
}

const nodeId = (group, type, path) => JSON.stringify([group, type, path]);
const compareNames = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const compareNodes = (a, b) => Number(!a.children) - Number(!b.children)
  || compareNames(a.name, b.name) || compareNames(a.id, b.id);

function branchFolder(name, group, branches) {
  const root = { id: nodeId(group, "folder", ""), name, children: [] };
  const folders = new Map([["", root]]);
  for (const branch of branches) {
    const parts = branch.name.split("/");
    let parent = root, path = "";
    for (const part of parts.slice(0, -1)) {
      path = path ? `${path}/${part}` : part;
      let folder = folders.get(path);
      if (!folder) {
        folder = { id: nodeId(group, "folder", path), name: part, children: [] };
        folders.set(path, folder);
        parent.children.push(folder);
      }
      parent = folder;
    }
    parent.children.push({ id: nodeId(group, "branch", branch.ref), name: parts.at(-1), branch });
  }
  for (const folder of folders.values()) folder.children.sort(compareNodes);
  return root;
}

export function branchTree(branches, pins) {
  const local = branches.filter((branch) => branch.kind === "local");
  const remote = branches.filter((branch) => branch.kind === "remote");
  const pinned = { id: nodeId("pinned", "folder", ""), name: "Pinned", children: [] };
  for (const [name, kind, candidates] of [["Local", "local", local], ["Remote", "remote", remote]]) {
    const selected = candidates.filter((branch) => pins.has(branch.ref));
    if (selected.length) pinned.children.push(branchFolder(name, `pinned/${kind}`, selected));
  }
  return [pinned, branchFolder("Local", "local", local), branchFolder("Remote", "remote", remote)];
}

export function treeRows(nodes, collapsed) {
  const rows = [];
  const visit = (siblings, depth) => {
    for (const node of siblings) {
      rows.push({ ...node, depth });
      if (node.children && !collapsed.has(node.id)) visit(node.children, depth + 1);
    }
  };
  visit(nodes, 0);
  return rows;
}
