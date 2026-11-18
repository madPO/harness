import { contextKey, repositoryKey, unifiedFiles } from "./model.js";
import { readSnapshot, readPrevious, perform } from "./git.js";

// Effects live here and in git.js; native rendering only issues controller actions.
export class ChangesController {
  constructor({ exec, location, changed = () => {}, publish = () => {} }) {
    Object.assign(this, { exec, location, changed, publish, snapshot: null, error: null,
      loading: false, busy: false, closed: false, generation: 0, drafts: new Map(),
      checked: new Set(), known: new Set(), normalChecked: null, amend: false, previous: null, amendDraft: null, amendGeneration: 0, amendLoading: false });
  }

  // Render may invalidate JavaScript state, but notifications and native input writes stay deferred.
  transition(context = this.location()) {
    const key = contextKey(context);
    if (this.closed || key === this.context) return false;
    this.clearAmend();
    this.context = key; this.snapshot = null; this.error = null;
    this.checked = new Set(); this.known = new Set();
    this.generation++; this.loading = false;
    return true;
  }

  files() { return unifiedFiles(this.snapshot, this.amend ? this.previous?.files : []); }

  toggleFiles(paths) {
    if (this.closed || this.busy || this.loading || contextKey(this.location()) !== this.context) return;
    const available = new Set(this.files().map((file) => file.path));
    const selected = [...new Set(paths)].filter((path) => available.has(path));
    const remove = selected.every((path) => this.checked.has(path));
    this.checked = new Set(this.checked);
    for (const path of selected) {
      if (remove) this.checked.delete(path); else this.checked.add(path);
      if (this.amend && this.known.has(path)) {
        if (remove) this.normalChecked.delete(path); else this.normalChecked.add(path);
      }
    }
    this.changed();
  }

  clearAmend() {
    this.amendGeneration++;
    this.amend = false; this.previous = null; this.amendDraft = null; this.normalChecked = null; this.amendLoading = false;
  }

  async setAmend(enabled) {
    if (this.closed || this.busy || !this.snapshot?.root || contextKey(this.location()) !== this.context) return;
    if (this.loading && !this.amendLoading) return;
    if (!enabled) {
      const pending = this.amendLoading, selection = this.normalChecked ?? this.checked;
      this.clearAmend();
      const normal = new Set(unifiedFiles(this.snapshot).map((file) => file.path));
      this.checked = new Set([...selection].filter((path) => normal.has(path)));
      if (pending) this.loading = false;
      this.changed();
      return;
    }
    if (this.loading || this.amend) return;
    if (!this.snapshot.head) { this.error = "Create a commit before enabling Amend"; this.changed(); return; }
    const snapshot = this.snapshot, context = this.context, generation = ++this.amendGeneration;
    const current = () => !this.closed && this.amendGeneration === generation && this.snapshot === snapshot
      && this.context === context && contextKey(this.location()) === context;
    this.amendLoading = true; this.loading = true; this.error = null; this.changed();
    try {
      const previous = await readPrevious(snapshot, this.exec);
      if (!current()) return;
      this.normalChecked = new Set(this.checked);
      this.previous = previous; this.amend = true; this.amendDraft = { message: previous.message };
      this.changed();
    } catch (error) {
      if (current()) this.error = String(error?.message ?? error);
    } finally {
      if (this.amendGeneration === generation) { this.amendLoading = false; this.loading = false; if (!this.closed) this.changed(); }
    }
  }

  draft(snapshot = this.snapshot) {
    if (!snapshot?.root) return { message: "" };
    if (this.amend && snapshot === this.snapshot) return this.amendDraft;
    const key = repositoryKey(snapshot);
    if (!this.drafts.has(key)) this.drafts.set(key, { message: "" });
    return this.drafts.get(key);
  }

  setDraft(message) {
    if (this.closed || !this.snapshot?.root || contextKey(this.location()) !== this.context) return;
    if (this.amend) this.amendDraft = { message };
    else this.drafts.set(repositoryKey(this.snapshot), { message });
    this.changed();
  }

  async refresh() {
    if (this.closed) return;
    const context = this.location(), key = contextKey(context);
    this.transition(context);
    if (this.loading || this.busy && this.snapshot) return;
    const generation = ++this.generation;
    const current = () => !this.closed && this.generation === generation && contextKey(this.location()) === key;
    this.loading = true; this.changed();
    try {
      const snapshot = await readSnapshot(context, this.exec);
      if (!current()) return;
      const previousSnapshot = this.snapshot;
      const changedRepository = previousSnapshot && repositoryKey(previousSnapshot) !== repositoryKey(snapshot);
      if (changedRepository) { this.checked = new Set(); this.known = new Set(); }
      if (previousSnapshot && (changedRepository || previousSnapshot.head !== snapshot.head || previousSnapshot.branch !== snapshot.branch)) {
        if (this.normalChecked) this.checked = new Set(this.normalChecked);
        this.clearAmend();
      }
      this.snapshot = snapshot;
      const normal = new Set(unifiedFiles(snapshot).map((file) => file.path));
      const available = new Set(this.files().map((file) => file.path));
      this.checked = new Set([...this.checked].filter((path) => available.has(path)));
      this.known = normal;
    } catch (error) {
      if (current()) this.error = String(error?.message ?? error);
    } finally {
      if (this.generation === generation) { this.loading = false; if (!this.closed) this.changed(); }
    }
  }

  async mutate(action) {
    if (this.closed || this.busy || this.loading || !this.snapshot || contextKey(this.location()) !== this.context) return;
    const snapshot = this.snapshot, context = this.context, generation = this.generation, draft = { ...this.draft(snapshot) };
    const amend = this.amend, paths = [...this.checked];
    this.busy = true; this.error = null; this.changed();
    const current = () => !this.closed && this.generation === generation && contextKey(this.location()) === context && this.context === context;
    try {
      if (action.paths && (action.paths.length !== paths.length || action.paths.some((path) => !this.checked.has(path)))) {
        this.error = "Selection changed. Confirm rollback again."; return;
      }
      const result = await perform(snapshot, { ...action, paths, ...(action.type === "commit" ? { ...draft, amend } : {}) }, this.exec, current);
      if (result.committed) {
        // Don't erase edits entered while Git hooks were running.
        const key = repositoryKey(snapshot), latest = this.drafts.get(key);
        if (amend) {
          const edited = this.amendDraft?.message !== draft.message ? this.amendDraft : null;
          if (current()) { this.clearAmend(); if (edited) this.drafts.set(key, edited); }
        } else if (latest?.message === draft.message) this.drafts.set(key, { message: "" });
      }
      if (!result.ok && current()) this.error = result.message;
    } finally {
      this.busy = false;
      this.publish();
      if (!this.closed) { this.changed(); await this.refresh(); }
    }
  }

  close() { this.closed = true; this.generation++; this.amendGeneration++; }
}
