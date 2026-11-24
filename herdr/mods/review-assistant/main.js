import { View } from "gpui-kit";
import { appHome, checking, exec, focused, layout, panes, setShared, shared, spaces, writeTextFile } from "herdr";
import { resolveContext } from "./context.js";
import { ReviewController } from "./controller.js";
import { createCoreExecutor } from "./core-exec.js";
import { demoReview } from "./demo.js";
import { readBranches } from "./git.js";
import { launchKey, reviewLaunchers, runAnalysis } from "./provider.js";
import { closeReviewView, renderReview, syncReviewView } from "./view.js";

const POLL_MS = 10_000;
const LAUNCHER_APPROVALS = "review-assistant.launcher-approvals";
const LAUNCHER_CHANGED = "The approved action changed or disappeared. Choose an action again.";
const location = () => reviewPanelActive() ? resolveContext(spaces(), panes(), focused()) : null;
const sameLocation = (a, b) => a && b && a.space === b.space && a.cwd === b.cwd && a.on === b.on;
const hasRef = (options, ref) => options?.some((branch) => branch.ref === ref);
const launcherPlace = ({ on, cwd }) => JSON.stringify([on, cwd]);
const approvedLauncher = (place) => shared(LAUNCHER_APPROVALS)?.[place] ?? null;
const findLauncher = (options, key) => key && options?.find((option) => launchKey(option) === key);
const sameLaunchers = (a, b) => a.length === b.length && a.every((option, i) => launchKey(option) === launchKey(b[i]));
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
  if (!session?.location.cwd) return "Select a workspace folder to choose a review action.";
  if (session.launcherNotice) return session.launcherNotice;
  if (!session.launcherOptions.length) return "Add an OMP wrapper in Actions to enable Compare.";
  return launcher ? null : "Choose a review action to enable Compare.";
}

function saveLauncher(session, identity) {
  const approvals = { ...shared(LAUNCHER_APPROVALS) };
  if (identity === null) delete approvals[session.place];
  else approvals[session.place] = identity;
  setShared(LAUNCHER_APPROVALS, approvals);
  session.launcherApproval = identity;
  session.compared = null;
}

function newSession(location, previous) {
  return {
    location, active: true, place: launcherPlace(location), target: previous?.target ?? null,
    inventory: null, error: null, reading: false, preselect: previous?.preselect ?? true, nextProbe: 0,
    comparing: null, compared: null, launcherOptions: [], launcherApproval: null, launcherNotice: null,
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
    const approval = session?.launcherApproval;
    const launcher = findLauncher(session?.launcherOptions, approval) || null;
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
      launcherError: Boolean(session?.launcherNotice),
      launcherComparing: Boolean(session?.comparing),
      launcherLocation: session?.location.cwd ? session.location : null,
      canCompare: Boolean(target && session.inventory.current && launcher && !session.comparing && controllerModel.canRefresh),
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
    if (session?.location.cwd) this.discoverLaunchers(session);
    const now = Date.now();
    if (session?.location.cwd && now >= session.nextProbe) {
      session.nextProbe = now + POLL_MS;
      this.loadBranches(session, cx);
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

  discoverLaunchers(session) {
    const options = reviewLaunchers(shared("t3-actions.actions")?.list);
    if (!sameLaunchers(session.launcherOptions, options)) {
      session.launcherOptions = options;
      this.needsSync = true;
    }
    const approval = approvedLauncher(session.place);
    if (approval && !findLauncher(options, approval)) {
      saveLauncher(session, null);
      session.launcherNotice = LAUNCHER_CHANGED;
      this.needsSync = true;
    } else if (approval !== session.launcherApproval) {
      session.launcherApproval = approval;
      session.compared = null;
      session.launcherNotice = null;
      this.needsSync = true;
    }
  }

  async prepareAnalysis() {
    const session = this.activeSession(), comparison = session?.comparing;
    const requireCurrent = () => {
      if (!comparison || this.activeSession() !== session || session.comparing !== comparison
          || this.controller.context !== comparison.context || session.target !== comparison.ref) {
        throw new Error("The comparison changed before launch. Select Compare again.");
      }
      this.discoverLaunchers(session);
      if (session.launcherApproval !== comparison.identity) {
        throw new Error(LAUNCHER_CHANGED);
      }
    };
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
    if (!session?.location.cwd || session.location !== renderedLocation || session.comparing) return;
    this.discoverLaunchers(session);
    if (!findLauncher(session.launcherOptions, identity)) {
      this.syncModel(cx);
      return;
    }
    if (session.launcherApproval !== identity) saveLauncher(session, identity);
    session.launcherNotice = null;
    this.needsSync = true;
    this.syncModel(cx);
  }

  clearLauncher(cx, renderedLocation = this.activeSession()?.location) {
    const session = this.activeSession();
    if (!session || session.location !== renderedLocation || session.comparing || !approvedLauncher(session.place)) return;
    saveLauncher(session, null);
    session.launcherNotice = null;
    this.needsSync = true;
    this.syncModel(cx);
  }

  compare(cx, identity, ref, renderedLocation = this.activeSession()?.location) {
    const session = this.activeSession();
    if (!session?.location.cwd || session.location !== renderedLocation) return;
    this.discoverLaunchers(session);
    const model = this.model();
    if (!model.canCompare || !identity || session.target !== ref || launchKey(model.selectedLauncher) !== identity) {
      this.syncModel(cx);
      return;
    }
    const comparison = { ref, identity, launcher: model.selectedLauncher };
    session.comparing = comparison;
    this.start(cx, (controller) => {
      this.discoverLaunchers(session);
      if (session.target !== ref || session.launcherApproval !== identity) return;
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
