import { View, div } from "gpui-kit";
import { Button, InputState, Input, h_flex } from "gpui-base";
import { appHome, checking, exec, focused, layout, panes, readTextFile, spaces, theme } from "herdr";
import { resolveContext } from "./context.js";
import { ReviewController } from "./controller.js";
import { demoReview } from "./demo.js";
import { parseProviderConfig, providerKey, runAnalysis } from "./provider.js";
import { closeReviewView, renderReview, syncReviewView } from "./view.js";

const WORKTREE = { kind: "worktree" };
const POLL_MS = 10_000;
const location = () => reviewPanelActive() ? resolveContext(spaces(), panes(), focused()) : null;

async function prepareAnalysis() {
  const path = `${appHome()}/review-assistant.json`;
  let text;
  try {
    text = await readTextFile(path);
  } catch {
    throw new Error(`Couldn't read ${path}. Create the file or check its permissions, then retry analysis.`);
  }
  if (text == null) {
    throw new Error(`Create ${path} with an endpoint, model, and "consent": true. Then retry analysis.`);
  }
  const config = parseProviderConfig(text);
  const fetch = globalThis.fetch;
  if (typeof fetch !== "function") {
    throw new Error("Native fetch isn't available. Update Herdr, then retry analysis.");
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
      this.staticModel = this.demo ? demoReview() : {
        scopeLabel: "Not selected", status: "idle", message: null, result: null,
        expanded: new Set(), detail: null, canRefresh: false, canNavigate: false,
        canCompare: false, canUseWorktree: false,
      };
      syncReviewView(this, this.staticModel, cx);
      return;
    }

    this.targetBranch = typeof props?.targetBranch === "string" ? props.targetBranch.trim() : "";
    this.nextProbe = 0;
    this.controller = new ReviewController({
      exec: (command, args, options) => {
        if (this.closed) throw new Error("Review Assistant is closed.");
        return exec(command, args, options);
      },
      location,
      changed: () => { this.needsSync = true; },
      prepareAnalysis,
      scope: this.targetBranch ? { kind: "branch", target: this.targetBranch } : WORKTREE,
    });
    syncReviewView(this, this.controller.model(), cx);
    this.poll(cx);
    this.pollTimer = cx.timer.every(1000, (cx) => this.poll(cx));
  }

  syncModel(cx) {
    if (this.closed || !this.needsSync) return;
    this.needsSync = false;
    const model = this.controller?.model() ?? this.staticModel;
    if (this.branchInput && (!model.canCompare || this.branchContext !== this.controller?.context)) {
      this.dismissScopeInput();
    }
    syncReviewView(this, model, cx);
    cx.notify();
  }

  poll(cx) {
    if (this.closed) return;
    const moved = this.controller.sync();
    this.syncModel(cx);
    if (!reviewPanelActive()) {
      this.nextProbe = 0;
      return;
    }
    const now = Date.now();
    const { context } = this.controller;
    if (moved || this.probeContext !== context || now >= this.nextProbe) {
      this.probeContext = context;
      this.nextProbe = now + POLL_MS;
      this.start(cx, () => this.controller.probe());
    }
  }

  start(cx, action) {
    const { controller } = this;
    if (this.closed || !controller || !reviewPanelActive()) return;
    const { context } = controller;
    cx.spawn(async (cx) => {
      if (this.closed || this.controller !== controller) return;
      if (controller.sync() || controller.context !== context || !reviewPanelActive()) {
        this.nextProbe = 0;
        this.syncModel(cx);
        return;
      }
      // Render loading and completion with the task's own native context.
      try {
        const pending = action();
        this.syncModel(cx);
        await pending;
      } finally {
        this.syncModel(cx);
      }
    });
  }

  refresh(cx) {
    if (this.controller?.model().canRefresh) this.start(cx, () => this.controller.refresh());
  }

  toggle(id, cx) {
    if (this.controller) this.controller.toggle(id);
    else if (this.demo) {
      const expanded = new Set(this.staticModel.expanded);
      if (expanded.has(id)) expanded.delete(id);
      else expanded.add(id);
      this.staticModel = { ...this.staticModel, expanded };
      this.needsSync = true;
    }
    this.syncModel(cx);
  }

  openFile(path, cx) {
    const result = this.controller?.model().result;
    if (!result) return;
    this.start(cx, () => {
      if (this.controller.model().result === result) return this.controller.openFile(path);
    });
  }

  openReference(reference, cx, result) {
    this.start(cx, () => {
      if (this.controller.model().result === result) return this.controller.openReference(reference);
    });
  }

  closeDetail(cx) {
    this.controller?.closeDetail();
    this.syncModel(cx);
  }

  compare(cx) {
    if (!this.controller?.model().canCompare) return;
    if (!this.dismissScopeInput()) {
      const input = InputState.new({ value: this.targetBranch, placeholder: "Enter a target branch" });
      this.branchInput = input;
      this.branchContext = this.controller.context;
      this.submitFocus = cx.focus_handle();
      const focus = (value, cx) => {
        if (this.branchInput !== input) return;
        this.branchFocused = value;
        cx.notify();
      };
      input.on("focus", (_e, cx) => focus(true, cx));
      input.on("blur", (_e, cx) => focus(false, cx));
      input.on("change", (_e, cx) => { if (this.branchInput === input) cx.notify(); });
      input.on("submit", (_e, cx) => { if (this.branchInput === input) this.submitScope(cx); });
      input.focus();
    }
    cx.notify();
  }

  dismissScopeInput() {
    if (!this.branchInput) return false;
    const { branchInput: input, submitFocus } = this;
    this.branchInput = null;
    this.branchContext = null;
    this.submitFocus = null;
    this.branchFocused = false;
    input.release();
    submitFocus.release();
    return true;
  }

  submitScope(cx) {
    if (!this.controller?.model().canCompare || this.branchContext !== this.controller.context) return;
    const target = this.branchInput?.value().trim();
    if (!target) return;
    this.targetBranch = target;
    this.changeScope({ kind: "branch", target }, cx);
  }

  useWorktree(cx) {
    if (this.controller?.model().canUseWorktree) this.changeScope(WORKTREE, cx);
  }

  changeScope(scope, cx) {
    if (this.dismissScopeInput()) this.needsSync = true;
    this.controller.setScope(scope);
    this.syncModel(cx);
    this.nextProbe = 0;
    this.poll(cx);
  }

  scopeInput() {
    const t = theme();
    const disabled = !this.branchInput.value().trim();
    return h_flex().min_w(0).items_center().gap(4).on_key_down((e, cx) => {
      if (e.key !== "escape") return;
      cx.stop_propagation();
      if (this.dismissScopeInput()) cx.notify();
    })
      .child(Input.new(this.branchInput).flex_1().min_w(0).h(28).px(6).rounded(5).border(2).bg(t.input)
        .text_color(t.foreground).border_color(this.branchFocused ? t.accent : t.border)
        .tab_index(0).accessibility_label("Target branch"))
      .child(Button.new("review-submit-scope").relative().h(28).px(8).rounded(5).bg(t.raised)
        .text_color(t.foreground).font_medium().disabled(disabled)
        .when(disabled, (el) => el.opacity(0.5))
        .when(!disabled, (el) => el.track_focus(this.submitFocus).tab_index(0).cursor_pointer()
          .hover((s) => s.bg(t.hover)).active((s) => s.bg(t.selected)))
        .on_click((_e, cx) => this.submitScope(cx)).child("Compare")
        .when(!disabled && this.submitFocus.is_focused(), (el) => el
          .child(div().absolute().inset_0().rounded(5).border(2).border_color(t.accent))));
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.pollTimer?.cancel();
    this.pollTimer = null;
    this.controller?.close();
    this.dismissScopeInput();
    closeReviewView(this);
  }

  render() {
    const model = this.controller?.model() ?? this.staticModel;
    return renderReview(this, this.branchInput && model.canCompare && this.branchContext === this.controller?.context
      ? { ...model, scopeInput: this.scopeInput() } : model);
  }
}
