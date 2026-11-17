import { contextKey, repositoryKey } from "./model.js";
import { readSnapshot } from "./git.js";

// Git and persistence are effects; tree construction stays in the pure model.
export class BranchesController {
  constructor({ exec, location, changed = () => {}, loadPins, savePins }) {
    Object.assign(this, { exec, location, changed, loadPins, savePins, snapshot: null, error: null,
      loading: false, closed: false, pins: new Set(), context: "", generation: 0 });
  }

  // Rendering can invalidate old state synchronously without notifying recursively.
  transition(context = this.location()) {
    const key = contextKey(context);
    if (this.closed || this.context === key) return false;
    this.context = key;
    this.snapshot = null;
    this.error = null;
    this.pins = new Set();
    this.loading = false;
    this.generation++;
    return true;
  }

  async refresh() {
    if (this.closed) return;
    const context = { ...this.location() }, key = contextKey(context);
    this.transition(context);
    const generation = ++this.generation;
    const current = () => !this.closed && this.generation === generation && contextKey(this.location()) === key;
    this.loading = true;
    this.error = null;
    this.changed();
    try {
      const snapshot = await readSnapshot(context, this.exec);
      if (!current()) return;
      const pins = snapshot.state === "ready" ? new Set(this.loadPins(repositoryKey(snapshot))) : new Set();
      this.snapshot = snapshot;
      this.pins = pins;
    } catch (error) {
      if (current()) this.error = String(error?.message ?? error);
    } finally {
      if (!this.closed && this.generation === generation) {
        this.transition();
        this.loading = false;
        this.changed();
      }
    }
  }

  togglePin(branch) {
    if (this.closed || contextKey(this.location()) !== this.context || this.snapshot?.state !== "ready") return;
    if (!this.snapshot.branches.some((candidate) => candidate.ref === branch.ref)) return;
    const pins = new Set(this.pins);
    if (pins.has(branch.ref)) pins.delete(branch.ref);
    else pins.add(branch.ref);
    try {
      this.savePins(repositoryKey(this.snapshot), [...pins].sort());
      this.pins = pins;
    } catch (error) {
      this.error = String(error?.message ?? error);
    }
    this.changed();
  }

  close() {
    this.closed = true;
    this.loading = false;
    this.generation++;
  }
}
