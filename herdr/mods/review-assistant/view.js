import { div } from "gpui-kit";
import { Button, Editor, EditorState, Input, InputState, Popup, Select, h_flex, v_flex } from "gpui-base";
import { settings, theme } from "herdr";
import { launchKey } from "./provider.js";

const UI = { heading: 13, text: 12, label: 11, radius: 5, control: 24, inset: 12, detail: 168 };
const PICKER = { button: "review-target-branch", select: "review-branch-select", popup: "review-branch-popup",
  list: "review-branch-list", search: "review-branch-search", control: 28, row: 28, shown: 8, width: 180 };
const SEARCH_LABEL = "Search branches";
const SEARCH_CONTEXT = "ReviewBranchSearch";
const SEARCH_TAB = "review_branch_search_tab", SEARCH_BACK_TAB = "review_branch_search_back_tab";
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
const launcherOptionKey = (launcher) => `launcher-option:${launcher.key}`;
const showPath = (path) => path.replace(/[\x00-\x1f\x7f]/g, (c) => c === "\n" ? "\\n" : c === "\t" ? "\\t" : `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
const launchString = (value) => JSON.stringify(value).replace(/[\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g,
  (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
const launcherLabel = ({ name, key }) => `${showPath(name)} (${launchString(key)})`;
const canOpenFiles = (view, model) => model.canNavigate && typeof view.openFile === "function";
const canOpenRefs = (view, model) => model.canNavigate && typeof view.openReference === "function";

const branchKind = (branch) => branch.ref.startsWith("refs/heads/") ? "Local" : "Remote";
const branchName = (branch) => `${branch.label} (${branchKind(branch).toLowerCase()})`;
const pickerSize = (count) => Math.min(count, PICKER.shown) * PICKER.row;
const clamp = (value, max) => Math.max(0, Math.min(value, max));

const searchQuery = (value) => value.trim().toLowerCase();
const matchingBranches = (options, query) => query
  ? options.filter((option) => option.label.toLowerCase().includes(query))
  : options;

function revealBranch(picker, count, index) {
  const height = pickerSize(count);
  picker.top = clamp(Math.max(Math.min(picker.top, index * PICKER.row), (index + 1) * PICKER.row - height),
    count * PICKER.row - height);
}

function updateBranchMatches(search, options, query, highlight) {
  search.query = query;
  search.matches = matchingBranches(options, query);
  const index = highlight === null ? -1 : search.matches.findIndex((option) => option.ref === highlight);
  search.highlight = index < 0 ? null : highlight;
  if (index < 0) search.top = 0;
  else revealBranch(search, search.matches.length, index);
}

function closeBranchSearch(picker) {
  const { search } = picker;
  if (!search) return;
  picker.search = null;
  search.focusWork?.cancel();
  search.input.release();
}

// Native focus handles and editor state belong to the view lifecycle, not to render.
export function syncReviewView(view, model, cx) {
  const state = view.reviewView ??= {
    handles: new Map(), focused: null, watch: null, detail: null, editor: null,
    launcher: null,
    picker: { search: null },
  };
  const keys = new Set();
  const { picker } = state, options = model.branchOptions;
  if (options?.length) {
    keys.add("target-branch");
    keys.add("branch-menu");
    keys.add("compare");
    if (options !== picker.options && picker.search) {
      const { search } = picker;
      updateBranchMatches(search, options, search.query, search.highlight);
    }
  } else {
    closeBranchSearch(picker);
    picker.overTrigger = false;
  }
  picker.options = options;
  for (const option of model.launcherOptions ?? []) keys.add(launcherOptionKey(option));
  if (model.launcherApproved && typeof view.clearLauncher === "function") keys.add("clear-launcher");
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

  const selected = model.selectedLauncher;
  const identity = selected ? launchKey(selected) : null;
  if (identity !== (state.launcher?.identity ?? null)) {
    state.launcher?.editor.release();
    const argv = selected ? `[${selected.argv.map(launchString).join(", ")}]` : null;
    state.launcher = argv === null ? null : {
      identity, argv,
      editor: EditorState.new({
        value: argv, readonly: true, soft_wrap: true,
        font_family: settings()?.font_family, font_size: UI.text,
      }),
    };
  }
}

export function closeReviewView(view) {
  const state = view.reviewView;
  if (!state) return;
  closeBranchSearch(state.picker);
  state.watch?.cancel();
  for (const handle of state.handles.values()) handle.release();
  state.editor?.release();
  state.launcher?.editor.release();
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

function refreshBranchQuery(picker, search) {
  const query = searchQuery(search.input.value());
  if (query === search.query) return false;
  updateBranchMatches(search, picker.options, query, null);
  return true;
}

function selectBranchMatch(view, picker, option, focus, cx) {
  if (!option) return;
  closeBranchSearch(picker);
  focus.focus();
  view.selectBranch(option.ref, cx);
  cx.notify();
}

function openBranchSearch(view, state, selected, focus, keys, native, cx) {
  const { picker } = state;
  const input = InputState.new({ placeholder: SEARCH_LABEL });
  const search = { input, top: 0, focused: false };
  updateBranchMatches(search, picker.options, "", selected ?? null);
  picker.search = search;
  const active = () => view.reviewView === state && picker.search === search;
  const current = () => active() && picker.options === view.model().branchOptions;
  input.on("change", (_e, cx) => {
    if (current() && refreshBranchQuery(picker, search)) cx.notify();
  });
  input.on("submit", (_e, cx) => {
    if (!current()) return;
    const changed = refreshBranchQuery(picker, search);
    const { matches, highlight } = search;
    const option = (highlight && matches.find((option) => option.ref === highlight)) || matches[0];
    if (option) selectBranchMatch(view, picker, option, focus, cx);
    else if (changed) cx.notify();
  });
  const setFocused = (focused) => (_e, cx) => {
    if (!active() || search.focused === focused) return;
    search.focused = focused;
    cx.notify();
  };
  input.on("focus", setFocused(true));
  input.on("blur", setFocused(false));
  // Root Tab bindings run before raw key handlers. Override them only inside this popup.
  cx.bind_keys([
    { keystroke: "tab", action: SEARCH_TAB, context: SEARCH_CONTEXT },
    { keystroke: "shift-tab", action: SEARCH_BACK_TAB, context: SEARCH_CONTEXT },
  ]);
  // Native Select transfers focus after on_open_change returns.
  if (native) search.focusWork = cx.timer.after(0, () => {
    search.focusWork = null;
    if (current() && (keys.is_focused() || focus.is_focused())) input.focus();
  });
  else input.focus();
}

function branchList(view, t, model, picker, { keys, focus, active, zoom }) {
  const { search } = picker;
  const options = search.matches, count = options.length, height = pickerSize(count);
  const max = count * PICKER.row - height, top = clamp(search.top, max);
  const first = Math.floor(top / PICKER.row), end = Math.min(count, Math.ceil((top + height) / PICKER.row));
  const currentInventory = () => model.branchOptions === picker.options && picker.options === view.model().branchOptions;
  const currentRows = () => active() && currentInventory() && options === search.matches;
  const visible = (i) => i * PICKER.row < search.top + height && (i + 1) * PICKER.row > search.top;
  const dismiss = (cx, restore) => {
    if (!active()) return;
    closeBranchSearch(picker);
    if (restore) focus.focus();
    cx.notify();
  };
  const tabOut = (backward, cx) => {
    if (!active()) return;
    // The popup paints out of order. Traverse from its trigger, not the deferred input.
    focus.focus();
    if (backward) window.focus_prev();
    else window.focus_next();
    dismiss(cx, false);
  };
  const rows = [];
  for (let i = first; i < end; i++) {
    const option = options[i], selected = option.ref === model.targetBranch, highlighted = option.ref === search.highlight;
    rows.push(h_flex().id(`review-branch-option-${option.ref}`).h(PICKER.row).absolute().left(0).right(0).top(i * PICKER.row - top)
      .min_w(0).px(6).gap(6).rounded(UI.radius).items_center().cursor_pointer()
      .when(selected, (el) => el.bg(t.selected))
      .when(highlighted, (el) => el.bg(t.hover).aria_active_descendant())
      .on_hover((on, cx) => {
        if (!on || !currentRows() || !visible(i) || search.highlight === option.ref) return;
        search.highlight = option.ref;
        cx.notify();
      })
      .role("list_box_option").aria_selected(selected).accessibility_label(branchName(option))
      .on_click((_e, cx) => {
        cx.stop_propagation();
        if (!currentRows() || !visible(i)) return;
        if (refreshBranchQuery(picker, search)) { cx.notify(); return; }
        selectBranchMatch(view, picker, option, focus, cx);
      })
      .child(div().flex_1().min_w(0).truncate().child(option.label))
      .child(secondary(t, branchKind(option)).flex_none())
      .when(selected, (el) => el.child(div().flex_none().child("✓"))));
  }

  return v_flex().id(PICKER.list).w(picker.width ?? PICKER.width).mt(4).p(4).gap(4).rounded(UI.radius)
    .bg(t.popover).border_1().border_color(t.border).shadow_lg().track_focus(keys).key_context(SEARCH_CONTEXT)
    .on_action(SEARCH_TAB, (_e, cx) => tabOut(false, cx))
    .on_action(SEARCH_BACK_TAB, (_e, cx) => tabOut(true, cx))
    .on_mouse_down_out((_e, cx) => {
      if (!picker.overTrigger) dismiss(cx, false);
    })
    .on_key_down((event, cx) => {
      if (!active()) return;
      if (event.key === "escape") {
        cx.stop_propagation();
        dismiss(cx, true);
        return;
      }
      const modifiers = event.modifiers;
      if (modifiers?.control || modifiers?.platform || modifiers?.alt) return;
      if (event.key === "tab") {
        cx.stop_propagation();
        tabOut(Boolean(modifiers?.shift), cx);
        return;
      }
      if (modifiers?.shift || (event.key !== "up" && event.key !== "down")) return;
      cx.stop_propagation();
      if (!currentInventory()) return;
      const changed = refreshBranchQuery(picker, search);
      const { matches, highlight } = search;
      const count = matches.length;
      if (!count) { if (changed) cx.notify(); return; }
      const at = highlight === null ? -1 : matches.findIndex((option) => option.ref === highlight);
      const next = event.key === "down" ? (at + 1) % count : (at <= 0 ? count : at) - 1;
      search.highlight = matches[next].ref;
      revealBranch(search, count, next);
      cx.notify();
    })
    .child(div().id(PICKER.search).flex_none().child(Input.new(search.input).h(PICKER.control).px(6)
      .rounded(UI.radius).bg(t.input).border(2).border_color(search.focused ? t.accent : t.border)
      .text_size(UI.label).text_color(t.foreground).accessibility_label(SEARCH_LABEL)))
    .when(!count, (el) => el.child(secondary(t, "No matching branches.").px(6).py(4)))
    // Draw only visible rows. Native scroll areas cannot reveal a keyboard-highlighted row.
    .when(count > 0, (el) => el.child(div().id("review-branch-scroll").role("list_box")
      .relative().overflow_hidden().flex_none().h(height)
      .on_scroll_wheel((event, cx) => {
        cx.stop_propagation();
        if (!currentRows()) return;
        const next = clamp(search.top - event.delta.y / zoom, max);
        if (next === search.top) return;
        search.top = next;
        const at = search.highlight === null ? -1 : options.findIndex((option) => option.ref === search.highlight);
        const low = Math.ceil(next / PICKER.row), high = Math.floor((next + height) / PICKER.row) - 1;
        search.highlight = options[Math.max(low, Math.min(at, high))].ref;
        cx.notify();
      })
      .children(rows)));
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

  const { picker } = state, { search } = picker, zoom = Number(settings()?.zoom) || 1;
  const attached = () => view.reviewView === state && state.handles.get("target-branch") === focus;
  const active = () => attached() && picker.search === search;
  const show = (open, native, cx) => {
    if (!active() || open === Boolean(search)) return;
    if (open) {
      const live = view.model();
      if (live.branchOptions !== options || picker.options !== options) return;
      openBranchSearch(view, state, live.targetBranch, focus, keys, native, cx);
    } else {
      closeBranchSearch(picker);
      focus.focus();
    }
    cx.notify();
  };
  const button = focusRing(trigger(h_flex().id(PICKER.button))
    .w_full().track_focus(focus).tab_index(0).role("button").cursor_pointer()
    .hover((style) => style.bg(t.hover)).active((style) => style.bg(t.selected))
    .on_hover((on) => { if (attached()) picker.overTrigger = on; })
    .on_size_change((size, cx) => {
      if (!attached()) return;
      const width = size.width / zoom;
      if (width === picker.width) return;
      picker.width = width;
      if (picker.search) cx.notify();
    })
    .on_click((_e, cx) => show(!search, false, cx)), focus, t);
  return Select.new(PICKER.select).flex_1().min_w(0).accessibility_label("Target branch")
    .open(Boolean(search)).track_focus(focus)
    // The menu handle receives initial native focus; later keys must leave the caret in the input.
    .when(!search, (el) => el.content_focus_handle(keys))
    .on_open_change((open, cx) => show(open, true, cx))
    .child(Popup.new(PICKER.popup, button).w_full()
      .when(Boolean(search), (el) => el.content(branchList(view, t, model, picker, { keys, focus, active, zoom }))));
}

function comparisonHeader(view, t, model) {
  return h_flex().id("review-comparison").flex_none().min_w(0).items_center().p(UI.inset)
    .border_b(1).border_color(t.border).child(branchPicker(view, t, model));
}

function launcherButton(view, t, key, label, bg, enabled, action) {
  const focus = view.reviewView?.handles.get(key);
  return Button.new(`review-${key}`).min_h(PICKER.control).min_w(0).px(8).py(3).flex_none().rounded(UI.radius)
    .bg(bg).text_color(t.foreground).text_size(UI.label).font_medium().disabled(!enabled)
    .accessibility_label(label)
    .when(!enabled, (el) => el.opacity(0.5))
    .when(enabled, (el) => el.on_click((_event, cx) => action(cx)))
    .when(Boolean(enabled && focus), (el) => focusRing(el.track_focus(focus).tab_index(0).cursor_pointer()
      .hover((style) => style.bg(t.hover)).active((style) => style.bg(t.selected)), focus, t))
    .child(div().min_w(0).child(label));
}

function reviewLauncher(view, t, model) {
  const { launcherOptions = [], selectedLauncher, launcherLocation, launcherBusy, launcherError } = model;
  const comparing = model.launcherComparing || model.status === "loading";
  const identity = selectedLauncher ? launchKey(selectedLauncher) : null;
  const preview = view.reviewView?.launcher;
  const currentPreview = preview?.identity === identity ? preview : null;
  const canSelect = !launcherBusy && !comparing && typeof view.selectLauncher === "function";
  const canClear = model.launcherApproved && typeof view.clearLauncher === "function";
  const canCompare = Boolean(model.canCompare && currentPreview && !launcherBusy && !comparing);
  const feedback = model.launcherMessage ?? (comparing ? "Comparing branches…"
    : launcherBusy ? "Finding review launchers…"
    : selectedLauncher ? null
    : launcherOptions.length ? "Choose a review launcher to inspect its arguments."
    : "No review launcher is available. Check the agent programs configured for this workspace.");

  return v_flex().id("review-launcher").min_w(0).gap(6).role("group").accessibility_label("Review launcher")
    .child(heading("Review launcher"))
    .when(Boolean(feedback), (el) => el.child(secondary(t, feedback)
      .when(Boolean(launcherError), (message) => message.text_color(t.ansi1))
      .role(launcherError ? "alert" : "status")))
    .when(launcherOptions.length > 0, (el) => el.child(v_flex().min_w(0).gap(4)
      .role("group").accessibility_label("Available review launchers")
      .children(launcherOptions.map((option) => {
        const key = launchKey(option), selected = key === identity;
        const label = `${launcherLabel(option)}${selected ? " — selected" : ""}`;
        return launcherButton(view, t, launcherOptionKey(option), label, selected ? t.selected : t.input, canSelect,
          (cx) => view.selectLauncher(key, cx, launcherLocation)).w_full().border_1().border_color(t.border);
      }))))
    .child(v_flex().min_w(0).p(8).gap(4).rounded(UI.radius).border_1().border_color(t.border).bg(t.raised)
      .child(div().min_w(0).font_medium()
        .child(selectedLauncher ? `Selected agent: ${launcherLabel(selectedLauncher)}`
          : "No review launcher selected"))
      .when(Boolean(launcherLocation?.cwd), (el) => el
        .child(secondary(t, `Workspace machine: ${launcherLocation.on ? showPath(launcherLocation.on) : "Herdr Core (local)"}`))
        .child(secondary(t, `Working directory: ${showPath(launcherLocation.cwd)}`)))
      .when(Boolean(currentPreview), (el) => el
        .child(div().font_medium().child("Exact launch arguments (JSON)"))
        .child(div().h(UI.detail).w_full().min_w(0).overflow_hidden().rounded(UI.radius).border_1().border_color(t.border)
          .role("group").accessibility_label(`Exact launch arguments: ${currentPreview.argv}`)
          .child(Editor.new(currentPreview.editor).size_full())))
      .when(Boolean(canClear), (el) => el.child(h_flex().min_w(0)
        .child(launcherButton(view, t, "clear-launcher", "Clear launcher", t.background, !comparing,
          (cx) => view.clearLauncher(cx, launcherLocation))))))
    .child(div().min_w(0).child("Selecting Compare sends bounded Git evidence through the selected OMP provider."))
    .child(h_flex().min_w(0).child(launcherButton(view, t, "compare", "Compare", t.raised, canCompare,
      (cx) => view.compare(cx, identity, model.targetBranch, launcherLocation))));
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
        .child(reviewLauncher(view, t, model))
        .child(logicalChanges(view, t, model, result))
        .child(influence(view, t, model, result))))
    .when(Boolean(model.detail), (el) => el.child(detailRegion(view, t, model.detail)));
}
