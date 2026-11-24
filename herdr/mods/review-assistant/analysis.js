const MAX_GROUPS = 256;
const MAX_INFLUENCE = 64;
const MAX_EVIDENCE_IDS = 64;
const MAX_EVIDENCE_ID = 128;
const MAX_PATH = 4096;
const MAX_LABEL = 120;
const MAX_PROSE = 480;
const REVIEW_ACTION = /^(?:ensure|verify|confirm|check) +.*[\p{L}\p{N}]/iu;
const UNSAFE_PROSE = /[\p{Cc}\p{Cs}\u2028\u2029]/u;

function invalidReview() {
  throw new Error("The review launcher returned an invalid review. Check the selected OMP launcher, then try again.");
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBoundedString(value, max) {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function list(value, max, min = 0) {
  if (!Array.isArray(value) || value.length < min || value.length > max) invalidReview();
  return value;
}

function prose(value, max) {
  if (!isBoundedString(value, max) || UNSAFE_PROSE.test(value)) invalidReview();
  const text = value.trim();
  if (!text) invalidReview();
  return text;
}

function recommendation(value) {
  const text = prose(value, MAX_PROSE);
  if (!REVIEW_ACTION.test(text)) invalidReview();
  return text;
}

function validateGroups(raw, knownPaths) {
  const groups = [], ids = new Set(), coveredPaths = new Set();
  for (const group of list(raw, MAX_GROUPS)) {
    if (!isRecord(group)) invalidReview();
    const { id, importance } = group;
    if (!isBoundedString(id, 64) || !/^[a-z0-9]/i.test(id) || /[^a-z0-9_-]/i.test(id) || ids.has(id)) {
      invalidReview();
    }
    if (importance !== "high" && importance !== "medium" && importance !== "low") invalidReview();

    const title = prose(group.title, MAX_LABEL);
    const description = prose(group.description, MAX_PROSE);
    const keyToReview = recommendation(group.keyToReview);
    if (keyToReview === description) invalidReview();

    const groupPaths = new Set();
    for (const path of list(group.files, knownPaths.size, 1)) {
      if (!isBoundedString(path, MAX_PATH) || !knownPaths.has(path) || groupPaths.has(path)) invalidReview();
      groupPaths.add(path);
      coveredPaths.add(path);
    }
    ids.add(id);
    groups.push({ id, title, importance, description, keyToReview, files: [...groupPaths] });
  }
  if (coveredPaths.size !== knownPaths.size) invalidReview();
  return groups;
}

function indexEvidence(evidence, files, knownPaths) {
  const byId = new Map();
  if (!evidence.length) return byId;
  const oldPaths = new Set(files.map((file) => file.oldPath));
  for (const item of evidence) {
    const { id, path, symbol, line } = item;
    if (isBoundedString(id, MAX_EVIDENCE_ID) && isBoundedString(path, MAX_PATH)
      && !knownPaths.has(path) && !oldPaths.has(path) && isBoundedString(symbol, MAX_PROSE)
      && Number.isSafeInteger(line) && line > 0) {
      byId.set(id, item);
    }
  }
  return byId;
}

function validateInfluence(raw, evidence, files, knownPaths) {
  list(raw, MAX_INFLUENCE);
  const influence = [];
  if (!raw.length) return influence;
  const byId = indexEvidence(evidence, files, knownPaths);
  for (const item of raw) {
    if (!isRecord(item)) invalidReview();
    const name = prose(item.name, MAX_LABEL);
    const description = recommendation(item.description);
    const references = [], used = new Set();
    for (const id of list(item.evidenceIds, MAX_EVIDENCE_IDS)) {
      if (!isBoundedString(id, MAX_EVIDENCE_ID)) invalidReview();
      const match = byId.get(id);
      if (!match || used.has(id)) continue;
      const { path, symbol, line } = match;
      references.push({ path, symbol, line });
      used.add(id);
    }
    if (references.length) influence.push({ name, description, references });
  }
  return influence;
}

export function validateAnalysis(raw, files, evidence = []) {
  if (!isRecord(raw)) invalidReview();
  const knownPaths = new Set(files.map((file) => file.path));
  const groups = validateGroups(raw.groups, knownPaths);
  const influence = validateInfluence(raw.influence, evidence, files, knownPaths);
  return { groups, influence };
}
