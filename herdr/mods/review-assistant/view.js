import { div } from "gpui-kit";
import { Editor, EditorState, h_flex, v_flex } from "gpui-base";
import { settings, theme } from "herdr";

const UI = { title: 16, heading: 13, text: 12, label: 11, radius: 5, control: 24, inset: 12, detail: 168 };
const importance = { high: "High", medium: "Medium", low: "Low" };
const messages = {
  idle: "No review analysis is available.",
  loading: "Analyzing changes…",
  empty: "No changes to review in this scope.",
  error: "Review analysis failed. Check the analysis settings and try again.",
};

const resultFor = (model) => model.status === "ready" || model.status === "stale" ? model.result : null;
const groupKey = (group) => `group:${group.id}`;
const fileKey = (group, path) => `file:${JSON.stringify([group.id, path])}`;
const refKey = (index, ref) => `ref:${JSON.stringify([index, ref.path, ref.symbol, ref.line])}`;
const showPath = (path) => path.replace(/[\x00-\x1f\x7f]/g, (c) => c === "\n" ? "\\n" : c === "\t" ? "\\t" : `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
const canOpenFiles = (view, model) => model.canNavigate && typeof view.openFile === "function";
const canOpenRefs = (view, model) => model.canNavigate && typeof view.openReference === "function";

function scopeActions(view, model) {
  return [
    ["refresh", model.status === "error" ? "Retry analysis" : "Refresh", model.canRefresh, view.refresh],
    ["compare", "Compare…", model.canCompare, view.compare],
    ["worktree", "Use working tree", model.canUseWorktree, view.useWorktree],
  ].filter(([, , available, action]) => available && typeof action === "function");
}

// Native focus handles and editor state belong to the view lifecycle, not to render.
export function syncReviewView(view, model, cx) {
  const state = view.reviewView ??= { handles: new Map(), focused: null, watch: null, detail: null, editor: null };
  const keys = new Set(scopeActions(view, model).map(([key]) => key));
  const result = resultFor(model);
  if (result) {
    for (const group of result.groups) {
      keys.add(groupKey(group));
      if (model.expanded.has(group.id) && canOpenFiles(view, model)) {
        for (const path of group.files) keys.add(fileKey(group, path));
      }
    }
    if (canOpenRefs(view, model)) result.influence.forEach((item, i) => {
      for (const ref of item.references) keys.add(refKey(i, ref));
    });
  }
  if (model.detail && typeof view.closeDetail === "function") keys.add("close-detail");
  for (const [key, handle] of state.handles) {
    if (keys.has(key)) continue;
    state.handles.delete(key);
    if (state.focused === key) state.focused = null;
    handle.release();
  }
  for (const key of keys) if (!state.handles.has(key)) state.handles.set(key, cx.focus_handle());

  if (!state.handles.size) {
    state.watch?.cancel();
    state.watch = null;
    state.focused = null;
  } else if (!state.watch) {
    state.watch = cx.timer.every(150, (cx) => {
      let focused = null;
      for (const [key, handle] of state.handles) {
        if (handle.is_focused()) { focused = key; break; }
      }
      if (focused === state.focused) return;
      state.focused = focused;
      cx.notify();
    });
  }

  const detail = model.detail;
  if (detail?.title !== state.detail?.title || detail?.text !== state.detail?.text) {
    state.editor?.release();
    state.editor = detail ? EditorState.new({
      value: detail.text, readonly: true, soft_wrap: true,
      font_family: settings()?.font_family, font_size: UI.text,
    }) : null;
  }
  state.detail = detail;
}

export function closeReviewView(view) {
  const state = view.reviewView;
  if (!state) return;
  state.watch?.cancel();
  for (const handle of state.handles.values()) handle.release();
  state.editor?.release();
  view.reviewView = null;
}

function control(view, t, key, label, action) {
  const currentHandle = () => view.reviewView?.handles.get(key);
  const handle = currentHandle();
  const activate = (cx) => { cx.stop_propagation(); action(cx); cx.notify(); };
  return div().id(`review-${key}`).min_h(UI.control).min_w(0).flex_none().px(6).py(3).rounded(UI.radius)
    .text_size(UI.label).line_height(1.4).role("button").accessibility_label(label).cursor_pointer()
    .hover((s) => s.bg(t.hover)).active((s) => s.bg(t.selected))
    .on_click((_e, cx) => {
      if (handle !== currentHandle()) return;
      handle?.focus();
      activate(cx);
    })
    .when(Boolean(handle), (el) => el.track_focus(handle).tab_index(0).on_key_down((e, cx) => {
      if (handle === currentHandle() && handle.is_focused() && (e.key === "enter" || e.key === "space")) activate(cx);
    }))
    .when(Boolean(handle?.is_focused()), (el) => el.relative()
      .child(div().absolute().inset_0().rounded(UI.radius).border(2).border_color(t.accent)));
}

const heading = (text, size = UI.heading) => div().min_w(0).text_size(size).line_height(1.3).font_semibold().child(text);
const secondary = (t, text) => div().min_w(0).text_color(t.muted).child(text);

function pathRow(view, t, key, label, action) {
  return (action ? control(view, t, key, `Open ${label}`, action)
    : div().min_w(0).px(6).py(3).text_size(UI.label)).child(label);
}

function scopeHeader(view, t, model) {
  const actions = scopeActions(view, model);
  return v_flex().flex_none().min_w(0).p(UI.inset).gap(4).border_b(1).border_color(t.border)
    .child(heading("Review Assistant", UI.title))
    .child(secondary(t, "AI suggestions · Verify against the code"))
    .child(div().min_w(0).font_medium().child(`Scope: ${model.scopeLabel}`))
    .when(actions.length > 0, (el) => el.child(h_flex().gap(4).min_w(0).overflow_x_scroll()
      .children(actions.map(([key, label, , action]) => control(view, t, key, label, (cx) => action.call(view, cx))
        .bg(t.raised).font_medium().child(label)))))
    .when(Boolean(model.scopeInput), (el) => el.child(model.scopeInput));
}

function groupCard(view, t, model, group) {
  const open = model.expanded.has(group.id);
  const label = `Changed files (${group.files.length})`;
  return v_flex().id(`review-card-${group.id}`).min_w(0).p(8).gap(4).rounded(UI.radius).border_1().border_color(t.border).bg(t.raised)
    .child(h_flex().min_w(0).items_center().gap(6)
      .child(heading(group.title))
      .child(div().flex_none().px(4).rounded(4).border_1().border_color(t.border).bg(t.background)
        .text_size(UI.label).line_height(1.4).child(importance[group.importance])))
    .child(div().min_w(0).child(group.description))
    .child(v_flex().min_w(0).px(6).py(4).gap(2).rounded(4).border_1().border_color(t.border).bg(t.background)
      .child(div().font_semibold().child("Key to review:"))
      .child(div().min_w(0).child(group.keyToReview)))
    .child(control(view, t, groupKey(group), `${open ? "Collapse" : "Expand"} ${label} for ${group.title}`,
      (cx) => view.toggle(group.id, cx)).font_medium().child(`${open ? "▾" : "▸"} ${label}`))
    .when(open, (el) => el.child(v_flex().pl(8).min_w(0).border_t(1).border_color(t.border)
      .children(group.files.map((path) => pathRow(view, t, fileKey(group, path), showPath(path),
        canOpenFiles(view, model) ? (cx) => view.openFile(path, cx) : null)))));
}

function logicalChanges(view, t, model, result) {
  const status = model.status;
  const message = status === "stale"
    ? `Review is out of date. ${model.message || "Refresh to analyze the current changes."}`
    : model.message || messages[status];
  return v_flex().min_w(0).gap(6).child(heading("Logical Changes"))
    .when(Boolean(message), (el) => el.child(secondary(t, message).role(status === "error" ? "alert" : "status")))
    .when(Boolean(result), (el) => el.children(result.groups.map((group) => groupCard(view, t, model, group))))
    .when(status === "ready" && !message && !result?.groups.length, (el) => el.child(secondary(t, "No logical changes identified.")));
}

function influenceRow(view, t, model, item, index) {
  const open = canOpenRefs(view, model);
  const references = item.references.map((ref) => {
    const location = `${showPath(ref.path)}${ref.line == null ? "" : `:${ref.line}`}`;
    const label = ref.symbol ? `${location} · ${ref.symbol}` : location;
    return pathRow(view, t, refKey(index, ref), label, open ? (cx) => view.openReference(ref, cx, model.result) : null);
  });
  return v_flex().min_w(0).p(8).gap(4)
    .when(index > 0, (row) => row.border_t(1).border_color(t.border))
    .child(div().font_medium().child(item.name))
    .child(div().min_w(0).child(item.description))
    .children(references);
}

function influence(view, t, model, result) {
  const items = result?.influence ?? [];
  return v_flex().min_w(0).gap(6).child(heading("Influence"))
    .child(secondary(t, "Unchanged parts of the code that may be affected by the current changes."))
    .when(!items.length, (el) => el.child(secondary(t, result ? "Analysis found no credible influence candidates."
      : model.status === "empty" ? "No influence findings for this scope." : "Influence findings appear after analysis.")))
    .when(items.length > 0, (el) => el.child(v_flex().min_w(0).rounded(UI.radius).border_1().border_color(t.border).bg(t.raised)
      .children(items.map((item, i) => influenceRow(view, t, model, item, i)))));
}

function detailRegion(view, t, detail) {
  return v_flex().id("review-detail").flex_none().min_w(0).px(UI.inset).py(8).gap(4).bg(t.background)
    .border_t(1).border_color(t.border).role("group").accessibility_label(`Read-only preview: ${detail.title}`)
    .child(h_flex().min_w(0).items_center().gap(6)
      .child(div().flex_1().min_w(0).font_medium().child(detail.title))
      .when(typeof view.closeDetail === "function", (el) => el.child(control(view, t, "close-detail", "Close preview",
        (cx) => view.closeDetail(cx)).bg(t.raised).font_medium().child("Close preview"))))
    .when(detail.line != null, (el) => el.child(secondary(t, `Line ${detail.line}`)))
    .child(div().h(UI.detail).w_full().min_w(0).overflow_hidden().rounded(UI.radius).border_1().border_color(t.border)
      .child(Editor.new(view.reviewView.editor).size_full()));
}

export function renderReview(view, model) {
  const t = theme(), result = resultFor(model);
  return v_flex().id("review-assistant").size_full().min_h(0).min_w(0).bg(t.background).text_color(t.foreground)
    .text_size(UI.text).line_height(1.5)
    .child(scopeHeader(view, t, model))
    .child(div().id("review-scroll").flex_1().min_h(0).min_w(0).overflow_y_scrollbar()
      .child(v_flex().w_full().min_w(0).p(UI.inset).gap(12)
        .child(logicalChanges(view, t, model, result))
        .child(influence(view, t, model, result))))
    .when(Boolean(model.detail), (el) => el.child(detailRegion(view, t, model.detail)));
}
