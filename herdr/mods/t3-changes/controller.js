import { contextKey, repositoryKey, selectionKey } from "./model.js";
import { readSnapshot, readDiff, perform } from "./git.js";

// Effects live here and in git.js; native rendering only issues controller actions.
export class ChangesController {
  constructor({ exec, location, changed = () => {}, publish = () => {} }) {
    Object.assign(this, { exec, location, changed, publish, snapshot: null, selected: null, diff: null, error: null,
      loading: false, busy: false, closed: false, generation: 0, diffGeneration: 0, drafts: new Map() });
  }

  draft(snapshot = this.snapshot) {
    if (!snapshot?.root) return { subject: "", description: "" };
    const key = repositoryKey(snapshot);
    if (!this.drafts.has(key)) this.drafts.set(key, { subject: "", description: "" });
    return this.drafts.get(key);
  }

  setDraft(field, value) {
    if (!this.snapshot?.root || !["subject", "description"].includes(field)) return;
    this.drafts.set(repositoryKey(this.snapshot), { ...this.draft(), [field]: value });
    this.changed();
  }

  async refresh() {
    if (this.closed) return;
    const context = this.location(), key = contextKey(context), switched = key !== this.context;
    if (switched) {
      this.context = key; this.snapshot = null; this.selected = null; this.diff = null; this.error = null;
      this.diffGeneration++; this.generation++; this.loading = false;
    }
    if (this.loading || this.busy && !switched) return;
    const generation = ++this.generation;
    const current = () => !this.closed && this.generation === generation && contextKey(this.location()) === key;
    this.loading = true; this.changed();
    try {
      const snapshot = await readSnapshot(context, this.exec);
      if (!current()) return;
      if (this.snapshot && repositoryKey(this.snapshot) !== repositoryKey(snapshot)) this.diff = null;
      this.snapshot = snapshot;
      const files = [...snapshot.groups.unstaged, ...snapshot.groups.staged];
      const selected = files.find((file) => selectionKey(file) === selectionKey(this.selected)) ?? files[0] ?? null;
      // Reload unchanged selections without blanking the displayed diff.
      await this.select(selected);
    } catch (error) {
      if (current()) { this.error = String(error?.message ?? error); this.diff = null; }
    } finally {
      if (this.generation === generation) { this.loading = false; if (!this.closed) this.changed(); }
    }
  }

  async select(file) {
    const sameFile = file && selectionKey(file) === selectionKey(this.selected);
    this.selected = file;
    const generation = ++this.diffGeneration, context = this.context, snapshot = this.snapshot;
    if (!sameFile) this.diff = null;
    this.changed();
    if (!file || !snapshot) return;
    try {
      const diff = await readDiff(snapshot, file, this.exec);
      if (!this.closed && this.diffGeneration === generation && this.context === context && contextKey(this.location()) === context) this.diff = diff;
    } catch (error) {
      if (!this.closed && this.diffGeneration === generation && this.context === context && contextKey(this.location()) === context) {
        this.diff = [{ kind: "note", text: `Can't show this diff: ${error?.message ?? error}` }];
      }
    }
    if (!this.closed) this.changed();
  }

  async mutate(action) {
    if (this.closed || this.busy || this.loading || !this.snapshot) return;
    const snapshot = this.snapshot, context = this.context, generation = this.generation, draft = { ...this.draft(snapshot) };
    this.busy = true; this.error = null; this.changed();
    const current = () => !this.closed && this.generation === generation && contextKey(this.location()) === context && this.context === context;
    try {
      const result = await perform(snapshot, action.type === "commit" ? { ...action, ...draft } : action, this.exec, current);
      if (result.ok && action.type === "commit") {
        // Don't erase edits entered while Git hooks were running.
        const key = repositoryKey(snapshot), latest = this.drafts.get(key);
        if (latest?.subject === draft.subject && latest?.description === draft.description) this.drafts.set(key, { subject: "", description: "" });
      }
      if (!result.ok && current()) this.error = result.message;
    } finally {
      this.busy = false;
      this.publish();
      if (!this.closed) { this.changed(); await this.refresh(); }
    }
  }

  close() { this.closed = true; this.generation++; this.diffGeneration++; }
}
