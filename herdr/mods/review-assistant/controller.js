import { readSnapshot, readFileDiff } from "./git.js";
import { readInfluenceEvidence, readInfluenceSource } from "./influence.js";

const worktree = { kind: "worktree" };
const unselectedLocation = { space: null, cwd: null, on: null };
const sameLocation = (a, b) => a.space === b.space && a.cwd === b.cwd && a.on === b.on;
const sameScope = (a, b) => a.kind === b.kind && a.target === b.target;
const copyScope = (scope) => scope.kind === "branch" ? { kind: "branch", target: scope.target } : worktree;
const errorText = (error) => String(error?.message ?? error);
const actionLabel = (scope) => scope.kind === "branch" ? "Compare" : "Refresh";

function findReference(influence, reference) {
  if (!reference || typeof reference !== "object") return;
  const { path, symbol, line } = reference;
  for (const { references } of influence) {
    const match = references.find((ref) => ref.path === path && ref.symbol === symbol && ref.line === line);
    if (match) return match;
  }
}

function reviewModel(state) {
  const { context, snapshot, error, read, expanded, preview, review, stale, analysis, analysisError } = state ?? {};
  const hasLocation = Boolean(context?.location.cwd);
  const loading = Boolean(analysis || read?.loading);
  let status = "idle", message;
  if (!hasLocation) message = "Select a repository pane to review its changes.";
  else if (loading) {
    status = "loading";
    message = analysis?.message ?? "Reading Git changes…";
  } else if (error || analysisError) {
    status = "error";
    message = error || analysisError;
  } else if (stale) {
    status = "stale";
    message = stale;
  } else if (snapshot && !snapshot.files.length) {
    status = "empty";
    message = context.scope.kind === "branch"
      ? "No committed changes to review in this comparison."
      : "No changes to review in the working tree.";
  } else if (review && review.revision === snapshot?.revision) {
    status = "ready";
    message = preview?.error;
  } else message = `Select ${actionLabel(context.scope)} to analyze changes.`;

  return {
    status, message,
    result: status === "ready" || status === "stale" ? review?.result ?? null : null,
    expanded: expanded ?? new Set(), detail: status === "ready" ? preview?.detail ?? null : null,
    canRefresh: hasLocation && !loading,
    canNavigate: status === "ready",
  };
}

export class ReviewController {
  #active;
  #cache = new Map();

  constructor({ exec, location, changed = () => {}, scope = worktree, prepareAnalysis }) {
    Object.assign(this, { exec, location, changed, prepareAnalysis, closed: false });
    const live = location();
    this.#active = Boolean(live);
    this.#select(live ?? unselectedLocation, copyScope(scope));
  }

  #select(location, scope) {
    this.context = { location: { ...location }, scope };
    this.snapshot = null;
    this.error = null;
    this.read = null;
    this.analysis = null;
    this.analysisError = null;
    this.review = null;
    this.stale = null;
    this.preview = null;
    this.expanded = new Set();
  }

  #isCurrent(context) {
    if (this.closed || !this.#active || this.context !== context) return false;
    const live = this.location();
    return Boolean(live && sameLocation(context.location, live));
  }

  #keepCurrent(context) {
    this.sync();
    return !this.closed && this.#active && this.context === context;
  }

  model() {
    return reviewModel(this.#isCurrent(this.context) ? this : null);
  }

  sync() {
    if (this.closed) return false;
    const live = this.location();
    if (!live) {
      if (!this.#active) return false;
      this.#active = false;
      // End the active generation even if the same repository is selected on return.
      this.context = { ...this.context };
      this.snapshot = null;
      this.error = null;
      this.read = null;
      this.analysis = null;
      this.preview = null;
    } else {
      const moved = !sameLocation(this.context.location, live);
      if (this.#active && !moved) return false;
      if (moved) this.#select(live, this.context.scope);
      this.#active = true;
    }
    this.changed();
    return true;
  }

  setScope(scope) {
    if (this.closed) return;
    const live = this.location();
    if (!live) return;
    scope = copyScope(scope);
    if (sameScope(this.context.scope, scope) && sameLocation(this.context.location, live)) return;
    this.#select(live, scope);
    this.changed();
  }

  probe() {
    this.sync();
    return this.#requestSnapshot(this.context);
  }

  compare(target) {
    const previousRead = this.read;
    this.setScope({ kind: "branch", target });
    return this.#refresh(true, previousRead);
  }

  refresh() {
    return this.#refresh(false);
  }

  #refresh(force, previousRead) {
    this.sync();
    const context = this.context;
    if (!context.location.cwd || !this.#isCurrent(context)) return Promise.resolve();
    if (this.analysis) return this.analysis.promise;

    // A Compare press needs a snapshot read that started after the press.
    if (force && this.read === previousRead) this.read = null;
    const request = { force, snapshot: null, message: "Reading Git changes…" };
    request.promise = Promise.resolve().then(() => this.#analyze(context, request));
    this.analysis = request;
    this.analysisError = null;
    if (!this.preview?.detail) this.preview = null;
    this.changed();
    return request.promise;
  }

  #requestSnapshot(context) {
    if (!context.location.cwd || !this.#keepCurrent(context)) return Promise.resolve();
    if (this.read) return this.read.promise;

    const request = { loading: !this.snapshot && !this.error && !this.analysis };
    request.promise = Promise.resolve().then(() => this.#loadSnapshot(context, request));
    this.read = request;
    if (request.loading) this.changed();
    return request.promise;
  }

  async #recheck(context, current) {
    // Join a pending read first, then verify with one started after the async work.
    await this.read?.promise;
    if (current()) await this.#requestSnapshot(context);
  }

  async #analyze(context, request) {
    const current = () => this.analysis === request && this.#keepCurrent(context);
    try {
      await this.#requestSnapshot(context);
      if (!current() || this.error) return;
      const snapshot = this.snapshot;
      if (!snapshot?.files.length) return;

      request.snapshot = snapshot;
      if (!this.prepareAnalysis) {
        throw new Error(`Configure an analysis provider in the Herdr app home, then select ${actionLabel(context.scope)}.`);
      }
      const { key, run } = await this.prepareAnalysis();
      if (!current() || this.error) return;

      if (this.review && this.review.key !== key) {
        this.review = null;
        this.preview = null;
      }
      // The exact Git revision also includes the worktree, machine, and comparison scope.
      let results = request.force ? undefined : this.#cache.get(snapshot.revision);
      const cached = results?.get(key);
      let result = cached, failure;
      if (!cached) {
        request.message = "Analyzing changes…";
        this.changed();
        if (!current()) return;
        try {
          const evidence = await readInfluenceEvidence(this.exec, snapshot);
          if (!current()) return;
          await this.#recheck(context, current);
          if (!current() || this.error || this.snapshot?.revision !== snapshot.revision) return;
          result = await run(snapshot, evidence);
        } catch (cause) {
          failure = errorText(cause);
        }
      }

      if (!current()) return;
      await this.#recheck(context, current);
      if (!current() || this.error || this.snapshot?.revision !== snapshot.revision) return;
      if (failure !== undefined) {
        this.analysisError = failure;
        return;
      }
      if (result !== this.review?.result) {
        const expanded = new Set();
        for (const { id } of result.groups) if (this.expanded.has(id)) expanded.add(id);
        this.expanded = expanded;
      }
      if (!request.force && !cached) {
        if (!results) this.#cache.set(snapshot.revision, results = new Map());
        results.set(key, result);
      }
      this.review = { key, revision: snapshot.revision, result };
      this.stale = null;
    } catch (cause) {
      if (current()) this.analysisError = errorText(cause);
    } finally {
      if (this.analysis === request) {
        this.analysis = null;
        this.changed();
      }
    }
  }

  async #loadSnapshot(context, request) {
    if (this.read !== request || !this.#keepCurrent(context)) return;
    let snapshot, error = null;
    try {
      snapshot = await readSnapshot(this.exec, context.location, context.scope);
    } catch (cause) {
      error = errorText(cause);
    }
    if (this.read !== request || !this.#keepCurrent(context)) return;
    this.read = null;

    const revised = snapshot?.revision !== this.snapshot?.revision;
    const notify = request.loading || revised || error !== this.error;
    if (error !== null) {
      this.snapshot = null;
      if (this.analysis?.snapshot) this.analysis = null;
      this.preview = null;
    } else if (revised) {
      const oldRevision = this.snapshot?.revision ?? this.review?.revision;
      this.snapshot = snapshot;
      this.preview = null;
      if (snapshot.revision !== oldRevision) this.analysisError = null;
      if (!snapshot.files.length) {
        if (this.analysis?.snapshot) this.analysis = null;
        this.review = null;
        this.stale = null;
      } else if (this.analysis?.snapshot) {
        this.analysis = null;
        this.stale = `Changes updated during analysis. Select ${actionLabel(context.scope)} to analyze the current changes.`;
      } else if (this.review && snapshot.revision !== this.review.revision) {
        this.stale ??= `Changes updated. Select ${actionLabel(context.scope)} to analyze them.`;
      }
    }
    this.error = error;
    if (notify) this.changed();
  }

  toggle(id) {
    if (!this.model().result?.groups.some((group) => group.id === id)) return;
    const expanded = new Set(this.expanded);
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
    this.expanded = expanded;
    this.changed();
  }

  async openFile(path) {
    const { canNavigate, result } = this.model();
    if (!canNavigate || !result.groups.some((group) => group.files.includes(path))) return;
    return this.#openPreview(readFileDiff, path, "file diff");
  }

  async openReference(reference) {
    const { canNavigate, result } = this.model();
    if (!canNavigate) return;
    const match = findReference(result.influence, reference);
    if (match) return this.#openPreview(readInfluenceSource, match, "source reference");
  }

  async #openPreview(readDetail, target, label) {
    const { context, snapshot, review } = this;
    const previous = this.preview;
    const request = {};
    this.preview = request;
    if (previous?.detail || previous?.error) this.changed();
    const current = () => this.preview === request && this.snapshot === snapshot
      && this.review === review && this.#keepCurrent(context);
    if (!current()) return;

    let detail, failure;
    try {
      detail = await readDetail(this.exec, snapshot, target);
    } catch (cause) {
      failure = errorText(cause);
    }
    if (!current()) return;
    await this.#recheck(context, current);
    if (!current()) return;

    this.preview = detail ? { detail } : {
      error: `Couldn't open the ${label}: ${failure}. Select ${actionLabel(context.scope)} to try again.`,
    };
    this.changed();
  }

  closeDetail() {
    if (!this.#isCurrent(this.context)) return;
    const previous = this.preview;
    this.preview = null;
    if (previous?.detail || previous?.error) this.changed();
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.#active = false;
    this.#select(unselectedLocation, this.context.scope);
    this.#cache.clear();
  }
}
