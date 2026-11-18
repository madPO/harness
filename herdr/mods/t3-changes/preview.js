// Calculations only: layout eligibility and bounded, numbered unified diff rows.
import { displayPath } from "./model.js";

const find = (node, id) => node?.id === id ? node : (node?.children ?? []).reduce((hit, child) => hit ?? find(child, id), null);
export function wideChanges(root) {
  const panel = find(root, "panel");
  return Boolean(panel && !panel.hidden && find(root, "panel-body")?.active === "changes" && find(root, "work")?.hidden);
}

export const PREVIEW_LIMITS = { rows: 3000, line: 2000 };

export function parsePreview(text) {
  const rows = [];
  let old = 0, next = 0, inHunk = false, offset = 0, truncated = false, binary = false;
  while (offset < text.length && rows.length < PREVIEW_LIMITS.rows) {
    const end = text.indexOf("\n", offset), stop = end < 0 ? text.length : end;
    // Inspect metadata before hunk content, which can itself contain these words.
    const prefix = text.slice(offset, Math.min(stop, offset + 200));
    if (!inHunk && ((prefix.startsWith("Binary files ") && text.slice(Math.max(offset, stop - 7), stop) === " differ") || prefix === "GIT binary patch")) binary = true;
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(prefix);
    let kind = "meta", before = null, after = null;
    if (hunk) { old = Number(hunk[1]); next = Number(hunk[2]); inHunk = true; kind = "hunk"; }
    else if (inHunk && prefix.startsWith("+")) { kind = "add"; after = next++; }
    else if (inHunk && prefix.startsWith("-")) { kind = "remove"; before = old++; }
    else if (inHunk && prefix.startsWith(" ")) { kind = "context"; before = old++; after = next++; }
    const escaped = displayPath(text.slice(offset, Math.min(stop, offset + PREVIEW_LIMITS.line)));
    const long = stop - offset > PREVIEW_LIMITS.line || escaped.length > PREVIEW_LIMITS.line;
    truncated ||= long;
    rows.push({ kind, old: before, next: after, text: escaped.slice(0, PREVIEW_LIMITS.line - (long ? 1 : 0)) + (long ? "…" : "") });
    offset = end < 0 ? text.length : end + 1;
  }
  truncated ||= offset < text.length;
  return { state: binary ? "binary" : rows.length ? "ready" : "empty", rows,
    notice: truncated ? "Preview limited to 3,000 rows and 2,000 characters per line. Use your terminal for the complete diff." : null };
}
