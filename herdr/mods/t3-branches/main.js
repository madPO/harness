import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, Scrollbar, VirtualListScrollHandle, v_virtual_list } from "gpui-base";
import { spaces, panes, focused, exec, theme } from "herdr";
import { BranchesController } from "./controller.js";
import { branchTree, treeRows } from "./model.js";
import { resolveContext } from "./context.js";

const MOD = "mods/t3-branches";
// Match Changes' compact native tree and control scale.
const UI = { row: 24, header: 36, text: 12, radius: 5, scrollbar: 16, pad: 6.4, gap: 4.8, level: 27.2 };
const location = () => resolveContext(spaces(), panes(), focused());
const pinKey = (key) => `pins.v1:${key}`;
const problem = (error) => error instanceof Error ? error.message : String(error);

export default class Branches extends View {
  init(_props, cx) {
    this.id = `t3-branches-${Math.random().toString(36).slice(2)}`;
    this.handle = cx.focus_handle();
    this.handles = Object.fromEntries(["refresh", "tree", "pin"].map((id) => [id, cx.focus_handle()]));
    this.treeScroll = VirtualListScrollHandle.new();
    this.collapsed = new Set();
    this.visibleRows = [];
    this.treeAt = 0;
    this.selectedRef = null;
    this.storageError = null;
    this.controller = new BranchesController({ exec, location,
      changed: () => { this.syncRows(); cx.notify(); },
      loadPins: (key) => this.loadPins(key),
      savePins: (key, refs) => this.savePins(key, refs) });
    this.syncRows();
    this.start(cx, () => this.controller.refresh());
    // Watch focus outside render. Context transitions invalidate old reads before scheduling new work.
    this.focusWatch = cx.timer.every(150, (cx) => {
      if (this.controller.closed) return;
      const switched = this.requestContext(cx);
      const control = Object.keys(this.handles).find((id) => this.handles[id].is_focused());
      if (control !== this.focusedControl || switched) { this.focusedControl = control; cx.notify(); }
    });
  }

  close() {
    this.controller.close();
    this.contextWork?.cancel();
    this.focusWatch?.cancel();
    this.treeScroll.release();
  }

  start(cx, action) { cx.spawn(async () => { await action(); }); }

  requestContext(cx) {
    if (!this.controller.transition()) return false;
    this.selectedRef = null;
    this.storageError = null;
    this.collapsed.clear();
    this.treeAt = 0;
    this.syncRows();
    if (!this.contextWork) this.contextWork = cx.timer.after(0, (cx) => {
      this.contextWork = null;
      if (!this.controller.closed) this.start(cx, () => this.controller.refresh());
    });
    return true;
  }

  loadPins(key) {
    this.storageError = null;
    try {
      const stored = localStorage.getItem(pinKey(key));
      if (stored === null) return [];
      const refs = JSON.parse(stored);
      if (!Array.isArray(refs) || refs.some((ref) => typeof ref !== "string")) throw new Error("Invalid pin preferences");
      return refs;
    } catch (error) {
      this.storageError = `Couldn't load pinned branches: ${problem(error)}. Pin a branch to save new preferences.`;
      return [];
    }
  }

  savePins(key, refs) {
    try {
      localStorage.setItem(pinKey(key), JSON.stringify(refs));
      this.storageError = null;
    } catch (error) {
      this.storageError = `Couldn't save pinned branches: ${problem(error)}. Pins weren't saved; check local storage, then try pinning again.`;
    }
  }

  syncRows() {
    const before = this.visibleRows[this.treeAt];
    const rows = treeRows(branchTree(this.controller.snapshot?.branches ?? [], this.controller.pins), this.collapsed);
    const kept = before ? rows.findIndex((row) => row.id === before.id) : -1;
    this.visibleRows = rows;
    this.treeAt = kept >= 0 ? kept : Math.max(0, Math.min(this.treeAt, rows.length - 1));
    if (!this.controller.snapshot?.branches.some((branch) => branch.ref === this.selectedRef)) this.selectedRef = null;
    this.treeWidth = rows.reduce((width, row) => Math.max(width, 220 + row.depth * UI.level + row.name.length * UI.text), 240);
  }

  moveTo(at) {
    this.treeAt = Math.max(0, Math.min(this.visibleRows.length - 1, at));
    this.treeScroll.scroll_to_item(this.treeAt);
  }

  activate(row) {
    if (row.branch) this.selectedRef = row.branch.ref;
    else {
      if (this.collapsed.has(row.id)) this.collapsed.delete(row.id); else this.collapsed.add(row.id);
      this.syncRows();
    }
  }

  togglePin(row) {
    if (!row.branch || this.controller.loading) return;
    this.handles.tree.focus();
    this.controller.togglePin(row.branch);
    this.treeScroll.scroll_to_item(this.treeAt);
  }

  treeKey(e, cx) {
    if (!this.handles.tree.is_focused()) return;
    const rows = this.visibleRows, row = rows[this.treeAt];
    if (!row) return;
    if (["up", "down", "home", "end"].includes(e.key)) {
      this.moveTo(e.key === "home" ? 0 : e.key === "end" ? rows.length - 1 : this.treeAt + (e.key === "down" ? 1 : -1));
    } else if (e.key === "enter") this.activate(row);
    else if (e.key === "space" && row.branch && !this.controller.loading) this.togglePin(row);
    else if (e.key === "right" && row.children) {
      if (this.collapsed.has(row.id)) { this.collapsed.delete(row.id); this.syncRows(); }
      else if (rows[this.treeAt + 1]?.depth > row.depth) this.moveTo(this.treeAt + 1);
    } else if (e.key === "left") {
      if (row.children && !this.collapsed.has(row.id)) { this.collapsed.add(row.id); this.syncRows(); }
      else {
        for (let at = this.treeAt - 1; at >= 0; at--) {
          if (rows[at].depth < row.depth) { this.moveTo(at); break; }
        }
      }
    } else return;
    cx.stop_propagation(); cx.notify();
  }

  control(t, id, label, content, action, disabled = false, tabbable = true, key = id) {
    const handle = this.handles[id];
    let el = h_flex().id(`${this.id}-${key}`).h(UI.row).px(6).gap(4).flex_none().items_center().justify_center()
      .rounded(UI.radius).role("button").accessibility_label(label).disabled(disabled)
      .text_size(11).font_medium().text_color(t.accent)
      .when(disabled, (el) => el.opacity(0.5))
      .when(!disabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover))
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .on_click((_e, cx) => { cx.stop_propagation(); action(cx); cx.notify(); }))
      .child(content);
    if (handle && !disabled && tabbable) el = el.track_focus(handle).tab_index(0)
      .on_key_down((e, cx) => {
        if (!handle.is_focused() || !["enter", "space"].includes(e.key)) return;
        cx.stop_propagation(); action(cx); cx.notify();
      })
      .when(handle.is_focused(), (el) => el.relative().child(div().absolute().inset_0().rounded(UI.radius).border(2).border_color(t.accent)));
    return el;
  }

  row(t, row, at) {
    const branch = row.branch, open = !this.collapsed.has(row.id), c = this.controller;
    const on = Boolean(branch && this.selectedRef === branch.ref);
    const focus = at === this.treeAt && this.handles.tree.is_focused();
    const pinned = branch && c.pins.has(branch.ref);
    const label = branch ? `${branch.kind} branch ${branch.name}${branch.current ? ", current branch" : ""}${pinned ? ", pinned" : ""}`
      : `${open ? "Collapse" : "Expand"} folder ${row.name}`;
    const pin = branch ? this.control(t, "pin", `${pinned ? "Unpin" : "Pin"} ${branch.kind} branch ${branch.name}`,
      h_flex().gap(4).items_center()
        .child(svg(`${MOD}/icons/pin.svg`).size(12).flex_none())
        .child(pinned ? "Unpin" : "Pin"), () => this.togglePin(row), c.loading, at === this.treeAt, `pin-${row.id}`) : null;
    return h_flex().id(`${this.id}-row-${row.id}`).h(UI.row).mx(2).pl(UI.pad + row.depth * UI.level).pr(UI.pad)
      .gap(UI.gap).items_center().rounded(UI.radius).text_size(UI.text).relative()
      .when(on, (el) => el.bg(t.selected).font_medium()).when(!on, (el) => el.hover((s) => s.bg(t.hover)))
      .role("treeitem").accessibility_label(`${label}${on ? ", selected" : ""}`).cursor_pointer()
      .on_click((_e, cx) => { this.handles.tree.focus(); this.treeAt = at; this.activate(row); cx.notify(); })
      .child(div().size(16).flex_none().flex().items_center().justify_center()
        .when(!branch, (el) => el.child(svg(`${MOD}/icons/chevron-${open ? "down" : "right"}.svg`).size(12).text_color(t.muted))))
      .child(svg(`${MOD}/icons/${branch ? "branch" : "folder"}.svg`).size(16).flex_none().text_color(t.muted))
      .child(div().flex_1().whitespace_nowrap().child(row.name))
      .when(Boolean(branch?.current), (el) => el.child(h_flex().gap(4).items_center().flex_none().text_color(t.foreground).text_size(11)
        .child(svg(`${MOD}/icons/check.svg`).size(12)).child("Current")))
      .when(Boolean(pin), (el) => el.child(pin))
      .when(focus, (el) => el.child(div().absolute().inset_0().rounded(UI.radius).border(2).border_color(t.accent)));
  }

  tree(t) {
    const rows = this.visibleRows;
    return v_flex().w_full().flex_1().min_h(0).min_w(0)
      .child(div().flex_1().min_h(0).min_w(0).relative()
        .child(div().id(`${this.id}-tree-x`).size_full().min_w(0).overflow_x_scroll()
          .child(div().w_full().min_w(this.treeWidth).h_full().track_focus(this.handles.tree).tab_index(0)
            .role("tree").accessibility_label("Branches. Arrows navigate, Enter selects or expands, Space pins a branch. Tab reaches the focused branch's Pin button. Selecting never checks out a branch.")
            .on_key_down((e, cx) => this.treeKey(e, cx))
            .on_scroll_wheel((_e, cx) => cx.stop_propagation())
            .child(v_virtual_list(`${this.id}-tree-y`, rows.length, UI.row, (at) => rows[at].id,
              (range) => rows.slice(range.start, range.end).map((row, at) => this.row(t, row, range.start + at)))
              .track_scroll(this.treeScroll).size_full())))
        .child(Scrollbar.vertical(`${this.id}-tree-y`).mode("always").viewport_from_layout().absolute().inset_0()))
      .child(div().w_full().min_w(0).h(UI.scrollbar).flex_none().relative()
        .child(Scrollbar.horizontal(`${this.id}-tree-x`).mode("always").viewport_from_layout().absolute().inset_0()));
  }

  stateMessage() {
    const c = this.controller;
    if (c.loading) return "Refreshing branches…";
    if (c.error) return null;
    if (!c.snapshot || c.snapshot.state === "nofolder") return "No folder selected. Focus a terminal in a repository, then refresh.";
    if (c.snapshot.state === "norepo") return "This folder isn't a Git repository. Focus a repository, then refresh.";
    if (!c.snapshot.branches.length) return "No branches yet. Create a commit outside Branches, then refresh.";
    return null;
  }

  render() {
    const t = theme(), c = this.controller, state = this.stateMessage();
    return v_flex().id(this.id).size_full().min_h(0).min_w(0).bg(t.background).text_color(t.foreground).text_size(UI.text)
      .track_focus(this.handle).on_key_down((e, cx) => {
        if (this.handle.is_focused() && ["down", "enter", "tab"].includes(e.key)) {
          this.handles.tree.focus(); cx.stop_propagation(); cx.notify();
        }
      })
      .child(h_flex().h(UI.header).flex_none().px(8).gap(6).items_center()
        .child(div().flex_1().min_w(0).text_color(t.muted).child(`${c.snapshot?.branches.length ?? 0} branches · Read-only`))
        .child(this.control(t, "refresh", "Refresh branches", h_flex().gap(4).items_center()
          .child(svg(`${MOD}/icons/refresh.svg`).size(14).flex_none()).child("Refresh"),
          (cx) => this.start(cx, () => c.refresh()), c.loading)))
      .when(Boolean(c.error), (el) => el.child(v_flex().w_full().max_h(120).flex_none().overflow_y_scrollbar().px(10).py(6).gap(4)
        .role("alert").text_color(t.ansi1).child(c.error)
        .child(div().text_color(t.muted).child("Check Git's message, then refresh to try again."))))
      .when(Boolean(this.storageError), (el) => el.child(div().w_full().max_h(96).flex_none().overflow_y_scrollbar().px(10).py(6)
        .role("alert").text_color(t.ansi1).child(this.storageError)))
      .when(Boolean(state), (el) => el.child(div().w_full().flex_none().px(10).py(6).text_color(t.muted).child(state)))
      .child(this.tree(t));
  }
}
