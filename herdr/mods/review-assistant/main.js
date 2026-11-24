import { View } from "gpui-kit";
import { appHome, checking, exec, focused, knownAgents, layout, panes, setShared, shared, spaces, writeTextFile } from "herdr";
import { resolveContext } from "./context.js";
import { ReviewController } from "./controller.js";
import { createCoreExecutor } from "./core-exec.js";
import { demoReview } from "./demo.js";
import { readBranches } from "./git.js";
import { launchKey, reviewLaunchers, runAnalysis } from "./provider.js";
import { closeReviewView, renderReview, syncReviewView } from "./view.js";

const POLL_MS = 10_000;
const LAUNCHER_APPROVALS = "review-assistant.launcher-approvals";
const location = () => reviewPanelActive() ? resolveContext(spaces(), panes(), focused()) : null;
const sameLocation = (a, b) => a && b && a.space === b.space && a.cwd === b.cwd && a.on === b.on;
const hasRef = (options, ref) => options?.some((branch) => branch.ref === ref);
const launcherPlace = ({ on, cwd }) => JSON.stringify([on, cwd]);
const approvedLauncher = (place) => shared(LAUNCHER_APPROVALS)?.[place] ?? null;
const findLauncher = (options, key) => key && options?.find((option) => launchKey(option) === key);
const idleReview = { status: "idle", message: null, result: null, expanded: new Set(), detail: null, canNavigate: false };

function preselect(options, name) {
  if (!name) return null;
  if (name.startsWith("refs/")) return hasRef(options, name) ? name : null;
  const local = `refs/heads/${name}`;
  if (hasRef(options, local)) return local;
  const remote = `refs/remotes/${name}`;
  return hasRef(options, remote) ? remote : null;
}

function branchFeedback(session) {
  if (!session?.location.cwd) return "Open a folder inside a Git working tree to compare branches.";
  if (session.error) return session.error;
  if (!session.inventory) return "Reading Git branches…";
  if (!session.inventory.current) return "Check out a local branch before comparing branches.";
  if (!session.inventory.branches.length) return "There are no local or remote-tracking branches to compare.";
  return null;
}

function launcherFeedback(session, launcher) {
  if (!session?.location.cwd) return "Select a workspace folder to find review launchers.";
  if (session.launcherError) return session.launcherError;
  if (session.launcherNotice) return session.launcherNotice;
  if (!session.launcherOptions) return "Finding review launchers…";
  if (!session.launcherOptions.length) return "Configure an OMP launcher in Herdr for this workspace machine.";
  return launcher ? null : "Choose a launcher to enable Compare.";
}

function saveLauncher(place, identity) {
  const approvals = { ...shared(LAUNCHER_APPROVALS) };
  if (identity === null) delete approvals[place];
  else approvals[place] = identity;
  setShared(LAUNCHER_APPROVALS, approvals);
}

function newSession(location, previous) {
  return {
    location, active: true, place: launcherPlace(location), target: previous?.target ?? null,
    inventory: null, error: null, reading: false, preselect: previous?.preselect ?? true, nextProbe: 0,
    comparing: null, compared: null, launcherOptions: null, launcherReading: false,
    launcherError: null, launcherNotice: null,
  };
}

function reviewPanelActive() {
  const panel = layout()?.children?.find((node) => node.id === "panel");
  const body = panel?.children?.find((node) => node.id === "panel-body");
  const page = body?.children?.find((node) => node.id === body.active);
  return Boolean(panel && !panel.hidden && body && !body.hidden && page && !page.hidden
    && page.content?.mod === "review-assistant");
}

export default class ReviewAssistant extends View {
  init(props, cx) {
    this.demo = props?.demo === true;
    if (this.demo || checking()) {
      this.staticModel = this.demo ? demoReview() : idleReview;
      syncReviewView(this, this.staticModel, cx);
      return;
    }

    this.initialTarget = typeof props?.targetBranch === "string" ? props.targetBranch.trim() : "";
    this.controller = new ReviewController({
      exec: (command, args, options) => {
        if (this.closed) throw new Error("Review Assistant is closed.");
        return exec(command, args, options);
      },
      location,
      changed: () => { this.needsSync = true; },
      prepareAnalysis: () => this.prepareAnalysis(),
    });
    this.poll(cx);
    this.pollTimer = cx.timer.every(1000, (cx) => this.poll(cx));
  }

  activeSession() {
    const session = this.branchSession;
    return !this.closed && session?.active && sameLocation(session.location, location()) ? session : null;
  }

  syncLocation() {
    if (this.closed) return;
    this.controller.sync();
    const live = location(), previous = this.branchSession;
    if (!live) {
      if (!previous?.active) return;
      // Invalidate in-flight inventory reads even when the same location returns.
      this.branchSession = { ...previous, active: false };
    } else if (!sameLocation(previous?.location, live)) {
      this.branchSession = newSession(live);
    } else {
      if (previous.active) return;
      this.branchSession = newSession(live, previous);
    }
    this.needsSync = true;
  }

  model() {
    if (this.staticModel) return this.staticModel;
    const session = this.activeSession();
    const target = session?.inventory && session.target;
    const controllerModel = target ? this.controller.model() : null;
    const approval = session ? approvedLauncher(session.place) : null;
    const launcher = findLauncher(session?.launcherOptions, approval) || null;
    const launcherBusy = Boolean(session?.launcherReading || session?.comparing);
    const compared = session?.compared;
    const review = target && compared?.ref === target && launcher && compared.identity === approval
      ? controllerModel : idleReview;
    const branchMessage = branchFeedback(session);
    return {
      ...review,
      message: review.message ?? (review.status === "idle" && !branchMessage
        ? target ? launcher ? "Select Compare to review changes between these branches." : null
          : "Select a branch to compare."
        : null),
      branchOptions: session?.inventory?.branches,
      targetBranch: target,
      branchMessage,
      branchError: Boolean(session?.error),
      launcherOptions: session?.launcherOptions ?? [],
      selectedLauncher: launcher,
      launcherApproved: Boolean(approval),
      launcherMessage: launcherFeedback(session, launcher),
      launcherError: Boolean(session?.launcherError || session?.launcherNotice),
      launcherBusy,
      launcherComparing: Boolean(session?.comparing),
      launcherLocation: session?.location.cwd ? session.location : null,
      canCompare: Boolean(target && session.inventory.current && launcher && !launcherBusy && controllerModel.canRefresh),
    };
  }

  syncModel(cx) {
    if (this.closed || !this.needsSync) return;
    this.needsSync = false;
    syncReviewView(this, this.model(), cx);
    cx.notify();
  }

  poll(cx) {
    if (this.closed) return;
    this.syncLocation();
    const session = this.activeSession();
    const now = Date.now();
    if (session?.location.cwd && now >= session.nextProbe) {
      session.nextProbe = now + POLL_MS;
      this.loadBranches(session, cx);
      if (!session.comparing) this.loadLaunchers(session, cx);
      if (session.compared && !session.comparing && this.controller.model().canRefresh) {
        this.start(cx, (controller) => controller.probe());
      }
    }
    this.syncModel(cx);
  }

  loadBranches(session, cx) {
    if (session.reading) return;
    session.reading = true;
    cx.spawn(async (cx) => {
      if (this.activeSession() !== session) {
        this.syncLocation();
        this.syncModel(cx);
        return;
      }
      let inventory, error = null;
      try {
        inventory = await readBranches(this.controller.exec, session.location);
      } catch (cause) {
        error = String(cause?.message ?? cause) || "Couldn't read Git branches. Check the selected folder.";
      }
      if (this.activeSession() !== session) {
        this.syncLocation();
        this.syncModel(cx);
        return;
      }
      session.reading = false;
      session.error = error;
      session.inventory = inventory;
      if (inventory) {
        if (session.preselect) session.target = preselect(inventory.branches, this.initialTarget);
        else if (!hasRef(inventory.branches, session.target)) session.target = null;
        session.preselect = false;
      }
      this.needsSync = true;
      this.syncModel(cx);
    });
  }

  async discoverLaunchers(session) {
    if (this.activeSession() !== session) return;
    let options;
    try {
      const programs = await knownAgents({ on: session.location.on });
      if (!Array.isArray(programs)) throw new Error("Expected a launcher inventory.");
      options = reviewLaunchers(programs);
    } catch {
      if (this.activeSession() !== session) return;
      session.launcherOptions = null;
      session.launcherError = "Couldn't find review launchers. Check the workspace connection.";
      this.needsSync = true;
      return;
    }
    if (this.activeSession() !== session) return;

    const approval = approvedLauncher(session.place);
    if (approval && !findLauncher(options, approval)) {
      saveLauncher(session.place, null);
      session.compared = null;
      session.launcherNotice = "The approved launcher changed or disappeared. Choose a launcher again.";
    }
    session.launcherOptions = options;
    session.launcherError = null;
    this.needsSync = true;
  }

  loadLaunchers(session, cx) {
    if (session.launcherReading) return;
    session.launcherReading = true;
    this.needsSync = true;
    cx.spawn(async (cx) => {
      try {
        await this.discoverLaunchers(session);
      } finally {
        session.launcherReading = false;
        this.needsSync = true;
        this.syncLocation();
        this.syncModel(cx);
      }
    });
  }

  async prepareAnalysis() {
    const session = this.activeSession(), comparison = session?.comparing;
    const requireCurrent = () => {
      if (!comparison || this.activeSession() !== session || session.comparing !== comparison
          || this.controller.context !== comparison.context || session.target !== comparison.ref) {
        throw new Error("The comparison changed before launch. Select Compare again.");
      }
      if (session.launcherError) throw new Error(session.launcherError);
      if (approvedLauncher(session.place) !== comparison.identity
          || !findLauncher(session.launcherOptions, comparison.identity)) {
        throw new Error("The approved launcher changed or disappeared. Choose a launcher again.");
      }
    };
    requireCurrent();
    await this.discoverLaunchers(session);
    requireCurrent();
    const coreExec = createCoreExecutor({
      appHome,
      exec: (command, args, options) => {
        // Cleanup must still run if the workspace changes after staging.
        if (command !== "bun" || args[1] !== "cleanup") requireCurrent();
        return exec(command, args, options);
      },
      writeTextFile: (...args) => {
        requireCurrent();
        return writeTextFile(...args);
      },
    });
    return {
      key: comparison.identity,
      run: (snapshot, evidence) => {
        requireCurrent();
        return runAnalysis(coreExec, comparison.launcher, session.location, snapshot, evidence);
      },
    };
  }

  start(cx, action, settled) {
    const { controller } = this, session = this.activeSession();
    if (!session) return;
    const { context } = controller;
    cx.spawn(async (cx) => {
      try {
        this.syncLocation();
        if (this.activeSession() !== session || controller.context !== context) return;
        // Render loading and completion with the task's own native context.
        const pending = action(controller);
        this.syncModel(cx);
        await pending;
      } finally {
        settled?.();
        this.syncLocation();
        this.syncModel(cx);
      }
    });
  }

  toggle(id, cx) {
    if (this.controller) {
      if (this.model().result) this.controller.toggle(id);
    } else if (this.demo) {
      const expanded = new Set(this.staticModel.expanded);
      if (expanded.has(id)) expanded.delete(id);
      else expanded.add(id);
      this.staticModel = { ...this.staticModel, expanded };
      this.needsSync = true;
    }
    this.syncModel(cx);
  }

  openFile(path, cx, result) {
    this.start(cx, (controller) => {
      if (this.model().result === result) return controller.openFile(path);
    });
  }

  openReference(reference, cx, result) {
    this.start(cx, (controller) => {
      if (this.model().result === result) return controller.openReference(reference);
    });
  }

  closeDetail(cx) {
    this.controller?.closeDetail();
    this.syncModel(cx);
  }

  selectBranch(ref, cx) {
    const session = this.activeSession();
    if (!hasRef(session?.inventory?.branches, ref)) return;
    session.target = ref;
    this.needsSync = true;
    this.syncModel(cx);
  }

  selectLauncher(identity, cx, renderedLocation = this.activeSession()?.location) {
    const session = this.activeSession();
    if (!session || session.location !== renderedLocation || session.comparing || session.launcherReading
        || !findLauncher(session.launcherOptions, identity)) return;
    if (approvedLauncher(session.place) !== identity) {
      saveLauncher(session.place, identity);
      session.compared = null;
    }
    session.launcherNotice = null;
    this.needsSync = true;
    this.syncModel(cx);
  }

  clearLauncher(cx, renderedLocation = this.activeSession()?.location) {
    const session = this.activeSession();
    if (!session || session.location !== renderedLocation || session.comparing || !approvedLauncher(session.place)) return;
    saveLauncher(session.place, null);
    session.compared = null;
    session.launcherNotice = null;
    this.needsSync = true;
    this.syncModel(cx);
  }

  compare(cx, identity, ref, renderedLocation = this.activeSession()?.location) {
    const session = this.activeSession(), model = this.model();
    if (!session || session.location !== renderedLocation || !model.canCompare || !identity
        || session.target !== ref || launchKey(model.selectedLauncher) !== identity) return;
    const comparison = { ref, identity, launcher: model.selectedLauncher };
    session.comparing = comparison;
    this.start(cx, (controller) => {
      if (session.target !== ref || approvedLauncher(session.place) !== identity) return;
      session.compared = comparison;
      const pending = controller.compare(ref);
      comparison.context = controller.context;
      return pending;
    }, () => {
      session.comparing = null;
      this.needsSync = true;
    });
    this.needsSync = true;
    this.syncModel(cx);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.pollTimer?.cancel();
    this.pollTimer = null;
    this.controller?.close();
    closeReviewView(this);
  }

  render() {
    return renderReview(this, this.model());
  }
}
