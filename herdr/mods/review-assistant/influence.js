import { gitRead, validPath } from "./git.js";

const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?|vue|svelte|astro|py|rb|go|rs|cs|fsx?|java|kt|kts|swift|php|c|h|cc|cpp|hpp|scala|exs?|lua|sh|sql)$/i;
const MAX_PATH = 4096;
const MAX_PATCH_SCAN = 384 * 1024;
const MAX_TERMS = 20;
const MAX_GREP_SCAN = 192 * 1024;
const MAX_LOCATIONS = 256;
const MAX_BLOBS = 12;
const MAX_BLOB_SIZE = 192 * 1024;
const MAX_EVIDENCE = 12;
const EVIDENCE_BUDGET = 8 * 1024;
const MAX_SIGNAL_LINE = 1400;
const CALL = 1;
const GENERIC = new Set([
  "assert", "catch", "class", "constructor", "debug", "default", "delete", "error", "expect", "fetch", "filter",
  "foreach", "function", "getitem", "has", "include", "index", "init", "join", "length", "load", "main", "map",
  "match", "name", "parse", "post", "print", "println", "push", "read", "reduce", "removeitem", "render", "require",
  "resolve", "return", "save", "setitem", "setup", "size", "slice", "some", "sort", "split", "start", "string",
  "switch", "test", "then", "throw", "trim", "type", "update", "value", "while", "write",
]);
const IDENTIFIER = /^[A-Za-z_][\w$]{2,79}$/;
const SPECIFIER = /^[A-Za-z0-9_@./-]{3,100}$/;
const KEY = /^[A-Za-z0-9_][\w.:-]{3,79}$/;
const API_PATH = /^\/(?:api|v[1-9]\d*)\/[\w./:-]{3,88}$/;

function unchangedPath(path, excluded) {
  return validPath(path) && path.length <= MAX_PATH && !excluded.has(path);
}

function excludedPaths({ dirtyPaths, files }) {
  const excluded = new Set(dirtyPaths);
  for (const { path, oldPath } of files) {
    excluded.add(path);
    if (oldPath) excluded.add(oldPath);
  }
  return excluded;
}

function moduleStem(path) {
  return path.slice(path.lastIndexOf("/") + 1).replace(SOURCE_EXTENSION, "");
}

function changedModules(files) {
  const modules = new Set();
  for (const { path, oldPath } of files) {
    for (const name of [path, oldPath]) {
      if (validPath(name) && SOURCE_EXTENSION.test(name)) modules.add(name.replace(SOURCE_EXTENSION, ""));
    }
  }
  return modules;
}

function relativeModule(path, specifier) {
  const parts = path.split("/");
  parts.pop();
  for (const part of specifier.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/").replace(SOURCE_EXTENSION, "");
}

// Recognize relationships in code positions, not arbitrary words in source strings or comments.
function lineSignals(text) {
  if (text.length > MAX_SIGNAL_LINE || /^\s*(?:\*|--\s|<!--|#(?!\s*include\b))/.test(text)) return [];
  const signals = [];
  const symbol = (name, rank) => {
    if (IDENTIFIER.test(name) && !GENERIC.has(name.toLowerCase())) signals.push({ kind: "symbol", symbol: name, rank });
  };
  const literal = (kind, value, rank, target) => signals.push({ kind, symbol: value, rank, target });
  let code = "", offset = 0, end = text.length;
  for (const match of text.matchAll(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\/\/|\/\*|\s+#(?:\s|$)|["'`])/g)) {
    const before = text.slice(Math.max(offset, match.index - 120), match.index);
    code += text.slice(offset, match.index);
    if (!match[1]) {
      end = match.index;
      offset = end;
      break;
    }
    const value = match[1].slice(1, -1);
    if (SPECIFIER.test(value) && /(?:\b(?:from|import)\s*|\b(?:import|require)\s*\(\s*|^\s*#\s*include\s*)$/.test(before)) {
      if (/^\.\.?\//.test(value)) literal("module", moduleStem(value), 3, value);
      else if (!value.startsWith("/")) literal("package", value, 3);
    } else if (KEY.test(value) && /\b(?:localStorage|sessionStorage|searchParams|\w*[sS]torage|[cC]ache|prefs|settings|redis|cookies)\s*\.\s*(?:getItem|setItem|removeItem|get|set|has|delete|remove|put|read|write)\s*\(\s*$/.test(before)) {
      literal("key", value, 4);
    } else if (API_PATH.test(value) && /(?:\bfetch|\b(?:app|router|axios|client)\s*\.\s*(?:get|post|put|patch|delete|use))\s*\(\s*$/.test(before)) {
      literal("route", value, 4);
    }
    code += ' "" ';
    offset = match.index + match[0].length;
  }
  code += text.slice(offset, end);
  for (const match of code.matchAll(/\b(?:function(?:\s+|\s*\*\s*)|class\s+|interface\s+|type\s+|struct\s+|enum\s+|trait\s+|def\s+|fn\s+|func\s+(?:\([^)]*\)\s*)?|record\s+|(?:export\s+(?:declare\s+)?|pub\s+)(?:const|let|var|static)\s+)([A-Za-z_][\w$]*)/g)) {
    symbol(match[1], 4);
  }
  if (/^\s*(?:import|export|from)\b/.test(code)) {
    const names = code.match(/^\s*(?:import|export)\s+(?:type\s+)?(?:[\w$]+\s*,\s*)?\{([^{}]+)\}/)?.[1]
      ?? code.match(/^\s*(?:import(?:\s+type)?|from\s+[\w.]+\s+import|export\s+default)\s+([\w$, ]+?)(?=\s+from\b|\s*[;"=]|\s*$)/)?.[1];
    if (names) {
      for (const match of names.matchAll(/(?:^|,)\s*(?:type\s+)?([A-Za-z_][\w$]*)(?:\s+as\s+([A-Za-z_][\w$]*))?/g)) {
        symbol(match[1], 3);
        if (match[2]) symbol(match[2], 3);
      }
    }
  }
  for (const match of code.matchAll(/(?:\bmodule\.exports|\bexports)\.([A-Za-z_][\w$]*)\s*=/g)) symbol(match[1], 4);
  for (const match of code.matchAll(/(?<![\w$.])([A-Za-z_][\w$]*)\s*\(|\.([A-Za-z_][\w$]*)\s*\(/g)) {
    symbol(match[1] ?? match[2], CALL);
  }
  return signals;
}

function searchPlan({ files, patch }) {
  const terms = new Map(), modules = changedModules(files);
  function add({ kind, symbol, rank }) {
    if (!symbol || (kind === "module" && (!SPECIFIER.test(symbol) || GENERIC.has(symbol.toLowerCase())))) return;
    const existing = terms.get(symbol);
    if (!existing) terms.set(symbol, { rank, kinds: new Set([kind]) });
    else {
      existing.rank = Math.max(rank, existing.rank);
      existing.kinds.add(kind);
    }
  }
  for (const module of modules) {
    const target = module.endsWith("/index") ? module.slice(0, -6) : module;
    add({ kind: "module", symbol: moduleStem(target), rank: 3 });
  }
  const limit = Math.min(patch.length, MAX_PATCH_SCAN);
  let inHunk = false;
  for (let start = 0; start < limit;) {
    let end = patch.indexOf("\n", start);
    if (end === -1) end = patch.length;
    if (end > limit) break;
    const row = patch.slice(start, end);
    start = end + 1;
    const header = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@(?: (.*))?$/.exec(row);
    if (header) inHunk = true;
    else if (!/^[ +-]/.test(row) && row !== "\\ No newline at end of file") inHunk = false;
    if (!inHunk) continue;
    const edited = row[0] === "+" || row[0] === "-";
    const line = header ? header[1] ?? "" : row.slice(1);
    for (const signal of lineSignals(line)) {
      // A relative import qualifies through a changed path, not a coincidental module basename.
      if (signal.kind !== "module" && (edited || signal.rank === 4)) add(signal);
    }
  }
  return {
    terms: new Map([...terms].sort((a, b) => b[1].rank - a[1].rank).slice(0, MAX_TERMS)),
    modules,
  };
}

function locations(output, head, terms, excluded) {
  const prefix = `${head}:`, found = [];
  // -z delimits both the verbatim path and line number with NUL; -o emits one match per row.
  for (let start = 0, rows = 0; start < output.length && rows < MAX_LOCATIONS; rows++) {
    const pathEnd = output.indexOf("\0", start);
    const numberEnd = pathEnd < 0 ? -1 : output.indexOf("\0", pathEnd + 1);
    const matchEnd = numberEnd < 0 ? -1 : output.indexOf("\n", numberEnd + 1);
    if (matchEnd < 0 || matchEnd >= MAX_GREP_SCAN) break;
    const path = output.slice(start + prefix.length, pathEnd);
    const pinned = output.startsWith(prefix, start);
    const number = output.slice(pathEnd + 1, numberEnd);
    const symbol = output.slice(numberEnd + 1, matchEnd);
    start = matchEnd + 1;
    const term = terms.get(symbol), line = Number(number);
    if (pinned && unchangedPath(path, excluded) && SOURCE_EXTENSION.test(path)
      && term && /^[1-9]\d*$/.test(number) && Number.isSafeInteger(line)) {
      found.push({ path, line, symbol, term });
    }
  }
  return found.sort((a, b) => b.term.rank - a.term.rank);
}

async function treeBlobs(read, head, paths) {
  const result = await read(["ls-tree", "--full-tree", "-l", "-z", head, "--", ...paths]);
  if (result.code !== 0) throw new Error("Could not read the review commit. Try again or inspect Git in a terminal.");
  const requested = new Set(paths), blobs = new Map();
  for (const record of result.stdout.split("\0")) {
    const tab = record.indexOf("\t");
    if (tab < 0) continue;
    const path = record.slice(tab + 1);
    const metadata = /^100(?:644|755) blob ([0-9a-f]+) +([0-9]+)$/.exec(record.slice(0, tab));
    if (requested.has(path) && metadata && OID.test(metadata[1])) {
      blobs.set(path, { oid: metadata[1], size: Number(metadata[2]) });
    }
  }
  return blobs;
}
async function ignoredPaths(read, paths) {
  const results = await Promise.all(paths.map((path) => read(["check-ignore", "--quiet", "--no-index", "--", `./${path}`])));
  const ignored = new Set();
  for (const [index, result] of results.entries()) {
    if ((result.code !== 0 && result.code !== 1) || result.stdout || result.stderr) {
      throw new Error("Could not check ignored source paths. Try again or inspect Git in a terminal.");
    }
    if (result.code === 0) ignored.add(paths[index]);
  }
  return ignored;
}


async function sourceLines(read, blob) {
  const result = await read(["cat-file", "blob", blob.oid]);
  if (result.code !== 0) throw new Error("Could not read the committed source. Try again or inspect Git in a terminal.");
  if (result.stdout.length > MAX_BLOB_SIZE || /[\0\uFFFD]/.test(result.stdout)) return null;
  const lines = result.stdout.split("\n");
  if (lines.at(-1) === "") lines.pop();
  // Mask multiline comments and templates before checking a reported match.
  const code = result.stdout.replace(
    /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|(`(?:\\[\s\S]|[^`\\])*`)|\/\/[^\n]*|(\/\*[\s\S]*?(?:\*\/|$))/g,
    (token, template, comment) => comment || template?.includes("\n") ? token.replace(/[^\n]/g, " ") : token,
  ).split("\n");
  return { lines, code };
}

function matchesLocation(code, { path, line, symbol, term }, modules) {
  return lineSignals(code[line - 1] ?? "").some((signal) => {
    if (signal.symbol !== symbol || (term && !term.kinds.has(signal.kind))) return false;
    if (signal.kind !== "module") return true;
    const target = relativeModule(path, signal.target);
    return target !== null && (modules.has(target) || modules.has(`${target}/index`));
  });
}

function excerpt(lines, line, symbol, radius, width) {
  const rows = [];
  for (let number = Math.max(1, line - radius); number <= Math.min(lines.length, line + radius); number++) {
    const source = lines[number - 1].replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, "");
    const match = number === line ? source.indexOf(symbol) : 0;
    const start = Math.max(0, match - Math.floor(width / 3));
    const snippet = `${start ? "…" : ""}${source.slice(start, start + width)}${source.length > start + width ? "…" : ""}`;
    rows.push(`${number === line ? ">" : " "} ${number} | ${snippet}`);
  }
  return rows.join("\n");
}

export async function readInfluenceEvidence(exec, snapshot) {
  const { head } = snapshot;
  if (head === null) return [];
  if (!OID.test(head)) throw new Error("The review snapshot has an invalid commit. Try again.");
  const { terms, modules } = searchPlan(snapshot);
  if (!terms.size) return [];
  const read = (args) => gitRead(exec, snapshot, args);
  const grep = await read([
    `--attr-source=${head}`, "grep", "--fixed-strings", "--word-regexp", "--line-number", "--null", "--only-matching",
    "--no-column", "--no-color", "--no-textconv", "--no-recurse-submodules", "--full-name", "-I", "--threads=2", "--max-count=5",
    ...[...terms.keys()].flatMap((term) => ["-e", term]), head, "--",
  ]);
  if (grep.code === 1 && !grep.stdout && !grep.stderr) return [];
  if (grep.code !== 0) throw new Error("Could not search unchanged source. Try again or inspect Git in a terminal.");
  const byPath = new Map();
  for (const hit of locations(grep.stdout, head, terms, excludedPaths(snapshot))) {
    if (byPath.has(hit.path)) byPath.get(hit.path).push(hit);
    else if (byPath.size < MAX_BLOBS) byPath.set(hit.path, [hit]);
  }
  if (!byPath.size) return [];
  const ignored = await ignoredPaths(read, [...byPath.keys()]);
  const candidates = [...byPath.keys()].filter((path) => !ignored.has(path));
  if (!candidates.length) return [];
  const blobs = await treeBlobs(read, head, candidates);
  const paths = candidates.filter((path) => blobs.get(path)?.size <= MAX_BLOB_SIZE);
  const evidence = [];
  let budget = EVIDENCE_BUDGET;
  for (let start = 0; start < paths.length; start += 3) {
    const batch = paths.slice(start, start + 3);
    const sources = await Promise.all(batch.map((path) => sourceLines(read, blobs.get(path))));
    for (const [i, source] of sources.entries()) {
      if (!source) continue;
      const hits = byPath.get(batch[i]);
      const seen = new Set();
      for (const hit of hits) {
        const key = `${hit.line}:${hit.symbol}`;
        if (seen.has(key) || !matchesLocation(source.code, hit, modules)) continue;
        seen.add(key);
        const { path, line, symbol } = hit;
        const item = { id: `source-${evidence.length + 1}`, path, symbol, line, text: excerpt(source.lines, line, symbol, 1, 132) };
        // The model receives evidence nested in JSON. Count escaping and reserve up to three bytes per code unit.
        const cost = 3 * (JSON.stringify(JSON.stringify(item)).length + 2);
        if (cost > budget) continue;
        budget -= cost;
        evidence.push(item);
        if (evidence.length === MAX_EVIDENCE || budget < 300) return evidence;
      }
    }
  }
  return evidence;
}

export async function readInfluenceSource(exec, snapshot, reference) {
  const { path, line, symbol } = reference ?? {};
  const { head } = snapshot;
  if (!OID.test(head) || !unchangedPath(path, excludedPaths(snapshot)) || !Number.isSafeInteger(line) || line < 1
    || typeof symbol !== "string" || !(IDENTIFIER.test(symbol) || SPECIFIER.test(symbol) || KEY.test(symbol) || API_PATH.test(symbol))) {
    throw new Error("Select a valid unchanged source reference.");
  }
  const read = (args) => gitRead(exec, snapshot, args);
  if ((await ignoredPaths(read, [path])).has(path)) {
    throw new Error("The source file is ignored. Select another source reference.");
  }
  const blob = (await treeBlobs(read, head, [path])).get(path);
  if (!blob) throw new Error("The source file is not available in the review commit.");
  if (blob.size > MAX_BLOB_SIZE) throw new Error("The source file exceeds the preview limit. Inspect the committed file in a terminal.");
  const source = await sourceLines(read, blob);
  if (!source) throw new Error("This committed file is not a supported text preview. Inspect it in a terminal.");
  if (!matchesLocation(source.code, { path, line, symbol }, changedModules(snapshot.files))) {
    throw new Error("The source reference no longer matches the review commit.");
  }
  return { title: path, text: excerpt(source.lines, line, symbol, 6, 240), line };
}
