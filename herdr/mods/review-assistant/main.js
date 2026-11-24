import { View } from "gpui-kit";
import { appHome, checking, exec, focused, layout, panes, readTextFile, spaces } from "herdr";
import { resolveContext } from "./context.js";
import { ReviewController } from "./controller.js";
import { demoReview } from "./demo.js";
import { readBranches } from "./git.js";
import { parseProviderConfig, providerKey, runAnalysis } from "./provider.js";
import { closeReviewView, renderReview, syncReviewView } from "./view.js";

const POLL_MS = 10_000;
const location = () => reviewPanelActive() ? resolveContext(spaces(), panes(), focused()) : null;
const sameLocation = (a, b) => a && b && a.space === b.space && a.cwd === b.cwd && a.on === b.on;
const hasRef = (options, ref) => options?.some((branch) => branch.ref === ref);
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

async function prepareAnalysis() {
  const path = `${appHome()}/review-assistant.json`;
  let text;
  try {
    text = await readTextFile(path);
  } catch {
    throw new Error(`Couldn't read ${path}. Create the file or check its permissions, then press Compare.`);
  }
  if (text == null) {
    throw new Error(`Create ${path} with an endpoint, model, and "consent": true. Then press Compare.`);
  }
  const config = parseProviderConfig(text);
  const fetch = globalThis.fetch;
  if (typeof fetch !== "function") {
    throw new Error("Native fetch isn't available. Update Herdr, then press Compare.");
  }
  return {
    key: providerKey(config),
    run: (snapshot, evidence) => runAnalysis(fetch, config, snapshot, evidence),
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
      prepareAnalysis,
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
      this.branchSession = { ...previous, active: false, inventory: null, error: null, reading: false, comparing: false, nextProbe: 0 };
    } else if (!sameLocation(previous?.location, live)) {
      this.branchSession = {
        location: live, active: true, target: null, inventory: null, error: null,
        reading: false, comparing: false, comparedRef: null, preselect: true, nextProbe: 0,
      };
    } else {
      if (previous.active) return;
      this.branchSession = { ...previous, active: true };
    }
    this.needsSync = true;
  }

  model() {
    if (this.staticModel) return this.staticModel;
    const session = this.activeSession();
    const target = session?.inventory && session.target;
    const controllerModel = target ? this.controller.model() : null;
    const review = target && target === session.comparedRef ? controllerModel : idleReview;
    const branchMessage = branchFeedback(session);
    return {
      ...review,
      message: review.message ?? (review.status === "idle" && !branchMessage
        ? target ? "Select Compare to review changes between these branches." : "Select a branch to compare."
        : null),
      branchOptions: session?.inventory?.branches,
      targetBranch: target,
      branchMessage,
      branchError: Boolean(session?.error),
      canCompare: Boolean(target && session.inventory.current && !session.comparing && controllerModel.canRefresh),
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
    this.syncModel(cx);
    const session = this.activeSession();
    const now = Date.now();
    if (!session?.location.cwd || now < session.nextProbe) return;
    session.nextProbe = now + POLL_MS;
    this.loadBranches(session, cx);
    if (session.comparedRef && !session.comparing && this.controller.model().canRefresh) {
      this.start(cx, (controller) => controller.probe());
    }
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

  compare(cx) {
    const session = this.activeSession();
    if (!session || !this.model().canCompare) return;
    const ref = session.target;
    session.comparing = true;
    this.start(cx, (controller) => {
      session.comparedRef = ref;
      return controller.compare(ref);
    }, () => {
      session.comparing = false;
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
