import { div } from "gpui-kit";
import { Button, Editor, EditorState, Popup, Select, h_flex, v_flex } from "gpui-base";
import { settings, theme } from "herdr";

const UI = { heading: 13, text: 12, label: 11, radius: 5, control: 24, inset: 12, detail: 168 };
const PICKER = { button: "review-target-branch", select: "review-branch-select", popup: "review-branch-popup", list: "review-branch-list",
  control: 28, row: 28, shown: 8, width: 180 };
const importance = { high: "High", medium: "Medium", low: "Low" };
const messages = {
  loading: "Analyzing changes…",
  empty: "No changes to review between these branches.",
  error: "Review analysis failed. Check the analysis settings and try again.",
};

const resultFor = (model) => model.status === "ready" || model.status === "stale" ? model.result : null;
const groupKey = (group) => `group:${group.id}`;
const fileKey = (group, path) => `file:${JSON.stringify([group.id, path])}`;
const refKey = (index, ref) => `ref:${JSON.stringify([index, ref.path, ref.symbol, ref.line])}`;
const showPath = (path) => path.replace(/[\x00-\x1f\x7f]/g, (c) => c === "\n" ? "\\n" : c === "\t" ? "\\t" : `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
const canOpenFiles = (view, model) => model.canNavigate && typeof view.openFile === "function";
const canOpenRefs = (view, model) => model.canNavigate && typeof view.openReference === "function";

const branchKind = (branch) => branch.ref.startsWith("refs/heads/") ? "Local" : "Remote";
const branchName = (branch) => `${branch.label} (${branchKind(branch).toLowerCase()})`;
const pickerSize = (count) => Math.min(count, PICKER.shown) * PICKER.row;
const clamp = (value, max) => Math.max(0, Math.min(value, max));

function branchJump(picker, event, options, at) {
  const count = options.length;
  if (event.key === "down") return (at + 1) % count;
  if (event.key === "up") return (at <= 0 ? count : at) - 1;
  if (event.key === "home") return 0;
  if (event.key === "end") return count - 1;
  if (!event.key_char?.trim() || event.modifiers?.control || event.modifiers?.platform || event.modifiers?.alt) return -1;

  const now = Date.now(), letter = event.key_char.toLowerCase();
  picker.typed = now - (picker.typedAt ?? -Infinity) < 750 ? picker.typed + letter : letter;
  picker.typedAt = now;
  const repeated = [...picker.typed].every((letter) => letter === picker.typed[0]);
  const prefix = repeated ? picker.typed[0] : picker.typed;
  const start = Math.max(at + (repeated ? 1 : 0), 0);
  for (let i = 0; i < count; i++) {
    const index = (start + i) % count;
    if (options[index].label.toLowerCase().startsWith(prefix)) return index;
  }
  return -1;
}

function revealBranch(picker, count, index) {
  const height = pickerSize(count);
  picker.top = clamp(Math.max(Math.min(picker.top, index * PICKER.row), (index + 1) * PICKER.row - height),
    count * PICKER.row - height);
}

function showBranchList(picker, open, options, selected) {
  if (picker.open === open) return;
  picker.open = open;
  picker.highlight = open ? selected : null;
  picker.top = 0;
  picker.typed = "";
  picker.typedAt = undefined;
  if (open && selected) {
    const index = options.findIndex((option) => option.ref === selected);
    if (index >= 0) revealBranch(picker, options.length, index);
  }
}

// Native focus handles and editor state belong to the view lifecycle, not to render.
export function syncReviewView(view, model, cx) {
  const state = view.reviewView ??= {
    handles: new Map(), focused: null, watch: null, detail: null, editor: null,
    picker: { open: false, highlight: null, top: 0 },
  };
  const keys = new Set();
  const { picker } = state, options = model.branchOptions;
  if (options?.length) {
    keys.add("target-branch");
    keys.add("branch-menu");
    keys.add("compare");
    if (options !== picker.options && picker.highlight) {
      const index = options.findIndex((option) => option.ref === picker.highlight);
      if (index >= 0) revealBranch(picker, options.length, index);
      else picker.highlight = null;
    }
  } else {
    showBranchList(picker, false);
    picker.overTrigger = false;
  }
  picker.options = options;
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

const heading = (text) => div().min_w(0).text_size(UI.heading).line_height(1.3).font_semibold().child(text);
const secondary = (t, text) => div().min_w(0).text_color(t.muted).child(text);

function pathRow(view, t, key, label, action) {
  return (action ? control(view, t, key, `Open ${label}`, action)
    : div().min_w(0).px(6).py(3).text_size(UI.label)).child(label);
}

function branchList(t, model, picker, { keys, focus, show, choose, zoom }) {
  const options = model.branchOptions, count = options.length, height = pickerSize(count);
  const max = count * PICKER.row - height, top = clamp(picker.top, max);
  const first = Math.floor(top / PICKER.row), end = Math.min(count, Math.ceil((top + height) / PICKER.row));
  const rows = [];
  for (let i = first; i < end; i++) {
    const option = options[i], selected = option.ref === model.targetBranch, highlighted = option.ref === picker.highlight;
    rows.push(h_flex().id(`review-branch-option-${option.ref}`).h(PICKER.row).absolute().left(0).right(0).top(i * PICKER.row - top)
      .min_w(0).px(6).gap(6).rounded(UI.radius).items_center().cursor_pointer()
      .when(selected, (el) => el.bg(t.selected))
      .when(highlighted, (el) => el.bg(t.hover).aria_active_descendant())
      .on_hover((on, cx) => {
        if (!on || picker.highlight === option.ref) return;
        picker.highlight = option.ref;
        cx.notify();
      })
      .role("list_box_option").aria_selected(selected).accessibility_label(branchName(option))
      .on_click((_e, cx) => { cx.stop_propagation(); choose(option, cx); })
      .child(div().flex_1().min_w(0).truncate().child(option.label))
      .child(secondary(t, branchKind(option)).flex_none())
      .when(selected, (el) => el.child(div().flex_none().child("✓"))));
  }

  return v_flex().id(PICKER.list).w(picker.width ?? PICKER.width).mt(4).p(4).rounded(UI.radius)
    .bg(t.popover).border_1().border_color(t.border).shadow_lg().track_focus(keys).role("list_box")
    .on_mouse_down_out((_e, cx) => {
      if (!picker.overTrigger) { show(false); cx.notify(); }
    })
    .on_key_down((event, cx) => {
      const at = options.findIndex((option) => option.ref === picker.highlight);
      if (event.key === "enter" || event.key === "space") {
        if (at >= 0) choose(options[at], cx);
      } else if (event.key === "escape" || event.key === "tab") {
        show(false);
        focus.focus();
        cx.notify();
        if (event.key === "tab") return;
      } else {
        const next = branchJump(picker, event, options, at);
        if (next < 0) return;
        picker.highlight = options[next].ref;
        revealBranch(picker, count, next);
        cx.notify();
      }
      cx.stop_propagation();
    })
    // Draw only visible rows. Native scroll areas cannot reveal a keyboard-highlighted row.
    .child(div().id("review-branch-scroll").relative().overflow_hidden().flex_none().h(height)
      .on_scroll_wheel((event, cx) => {
        cx.stop_propagation();
        const next = clamp(picker.top - event.delta.y / zoom, max);
        if (next === picker.top) return;
        picker.top = next;
        const at = options.findIndex((option) => option.ref === picker.highlight);
        if (at >= 0) {
          const low = Math.ceil(next / PICKER.row), high = Math.floor((next + height) / PICKER.row) - 1;
          picker.highlight = options[Math.max(low, Math.min(at, high))].ref;
        }
        cx.notify();
      })
      .children(rows));
}

function focusRing(el, handle, t) {
  return el.when(Boolean(handle?.is_focused()), (el) => el.relative()
    .child(div().absolute().inset_0().rounded(UI.radius).border(2).border_color(t.accent)));
}

function branchPicker(view, t, model) {
  const options = model.branchOptions;
  const selected = options?.find((option) => option.ref === model.targetBranch);
  const state = view.reviewView, focus = state?.handles.get("target-branch"), keys = state?.handles.get("branch-menu");
  const enabled = Boolean(options?.length && focus && keys);
  const label = selected?.label ?? "Select branch";
  const trigger = (el) => el.h(PICKER.control).px(6).gap(6).rounded(UI.radius)
    .min_w(0).items_center().text_size(UI.label).bg(t.input).border_1().border_color(t.border)
    .accessibility_label(selected ? `Target branch: ${branchName(selected)}` : "Select branch")
    .child(div().flex_1().min_w(0).truncate().text_color(selected ? t.foreground : t.muted).child(label))
    .when(Boolean(selected), (el) => el.child(secondary(t, branchKind(selected)).flex_none()))
    .child(secondary(t, "▾").flex_none());
  if (!enabled) return trigger(Button.new(PICKER.button)).flex_1().disabled(true).opacity(0.5);

  const { picker } = state, zoom = Number(settings()?.zoom) || 1;
  const current = () => view.model().branchOptions === options;
  const show = (open) => {
    if (!open || current()) showBranchList(picker, open, options, model.targetBranch);
  };
  const choose = (option, cx) => {
    if (!current()) return;
    show(false);
    focus.focus();
    view.selectBranch(option.ref, cx);
  };
  const button = focusRing(trigger(h_flex().id(PICKER.button))
    .w_full().track_focus(focus).tab_index(0).role("button").cursor_pointer()
    .hover((style) => style.bg(t.hover)).active((style) => style.bg(t.selected))
    .on_hover((on) => { picker.overTrigger = on; })
    .on_size_change((size, cx) => {
      const width = size.width / zoom;
      if (width === picker.width) return;
      picker.width = width;
      if (picker.open) cx.notify();
    })
    .on_click((_e, cx) => {
      show(!picker.open);
      (picker.open ? keys : focus).focus();
      cx.notify();
    }), focus, t);
  return Select.new(PICKER.select).flex_1().min_w(0).accessibility_label("Target branch")
    .open(picker.open).track_focus(focus).content_focus_handle(keys)
    .on_open_change((open, cx) => { show(open); cx.notify(); })
    .child(Popup.new(PICKER.popup, button).w_full()
      .when(picker.open, (el) => el.content(branchList(t, model, picker, { keys, focus, show, choose, zoom }))));
}

function comparisonHeader(view, t, model) {
  const focus = view.reviewView?.handles.get("compare");
  const compare = Button.new("review-compare").h(PICKER.control).px(8).flex_none().rounded(UI.radius)
    .bg(t.raised).text_color(t.foreground).text_size(UI.label).font_medium().disabled(!model.canCompare)
    .when(!model.canCompare, (el) => el.opacity(0.5))
    .when(Boolean(model.canCompare && focus), (el) => focusRing(el.track_focus(focus).tab_index(0).cursor_pointer()
      .hover((style) => style.bg(t.hover)).active((style) => style.bg(t.selected)), focus, t))
    .on_click((_e, cx) => { if (model.canCompare) view.compare(cx); })
    .child("Compare");
  return h_flex().id("review-comparison").flex_none().min_w(0).items_center().p(UI.inset).gap(4)
    .border_b(1).border_color(t.border).child(branchPicker(view, t, model)).child(compare);
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
        canOpenFiles(view, model) ? (cx) => view.openFile(path, cx, model.result) : null)))));
}

function logicalChanges(view, t, model, result) {
  const status = model.status;
  const message = status === "stale"
    ? `Review is out of date. ${model.message || "Select Compare to analyze the current changes."}`
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
      : model.status === "empty" ? "No influence findings for this comparison." : "Influence findings appear after analysis.")))
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
    .child(comparisonHeader(view, t, model))
    .child(div().id("review-scroll").flex_1().min_h(0).min_w(0).overflow_y_scrollbar()
      .child(v_flex().w_full().min_w(0).p(UI.inset).gap(12)
        .when(Boolean(model.branchMessage), (el) => el.child(secondary(t, model.branchMessage)
          .role(model.branchError ? "alert" : "status")))
        .child(logicalChanges(view, t, model, result))
        .child(influence(view, t, model, result))))
    .when(Boolean(model.detail), (el) => el.child(detailRegion(view, t, model.detail)));
}
