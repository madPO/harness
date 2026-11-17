import { View, div } from "gpui-kit";
import { h_flex, v_flex, Checkbox, Textarea, TextareaState, Scrollbar, VirtualListScrollHandle, v_virtual_list } from "gpui-base";
import { spaces, panes, focused, exec, theme, settings, setShared } from "herdr";
import { ChangesController } from "./controller.js";
import { displayPath, repositoryKey, fileTree, treeRows } from "./model.js";
import { TREE_ROW, treeRow, statusBadge } from "./tree-row.js";
import { resolveContext } from "./context.js";

const UI = { header: 36, scrollbar: 16, text: 12, radius: 5, commitRadius: 8, commitHeight: 30 };
const location = () => resolveContext(spaces(), panes(), focused());

export default class Changes extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handles = Object.fromEntries(["refresh", "stash", "rollback", "confirm-rollback", "cancel-rollback", "all", "amend", "commit", "commit-push", "tree"].map((id) => [id, cx.focus_handle()]));
    this.collapsed = new Set(); this.width = 900; this.height = 600; this.treeAt = 0;
    this.treeScroll = VirtualListScrollHandle.new();
    this.id = `t3-changes-${Math.random().toString(36).slice(2)}`;
    this.messageState = TextareaState.new({ placeholder: "Commit message", value: "", rows: 5 });
    this.messageState.set_soft_wrap(true);
    this.controller = new ChangesController({ exec, location, changed: () => {
      this.syncMessage();
      for (const row of treeRows(fileTree(this.controller.files()), new Set(), "changes")) {
        const id = row.file ? `check-${row.path}` : `folder-${row.path}`;
        if (!this.handles[id]) this.handles[id] = cx.focus_handle();
      }
      if (this.rollbackRequest && this.rollbackRequest.key !== this.confirmationKey()) this.rollbackRequest = null;
      cx.notify();
    },
      publish: () => setShared("git-graph.changed", Date.now()) });
    this.messageState.on("change", (_e, cx) => { if (!this.syncing) this.controller.setDraft(this.messageState.value()); cx.notify(); });
    this.messageState.on("focus", (_e, cx) => { this.messageFocused = true; cx.notify(); });
    this.messageState.on("blur", (_e, cx) => { this.messageFocused = false; cx.notify(); });
    // Native Enter and Shift+Enter insert newlines. Only the Commit button submits.
    this.start(cx, () => this.controller.refresh());
    this.focusWatch = cx.timer.every(150, (cx) => {
      const switched = this.requestContext(cx);
      const key = Object.entries(this.handles).find(([, handle]) => handle.is_focused())?.[0];
      if (key !== this.focusedControl || switched) { this.focusedControl = key; cx.notify(); }
    });
  }

  close() { this.controller.close(); this.contextWork?.cancel(); this.focusWatch?.cancel(); this.treeScroll.release(); this.messageState.release(); }
  start(cx, action) { cx.spawn(async () => { await action(); }); }
  mutate(cx, action) { this.rollbackRequest = null; this.start(cx, () => this.controller.mutate(action)); }

  confirmationKey() {
    const c = this.controller;
    return JSON.stringify([c.context, c.snapshot?.head, [...c.checked].sort()]);
  }

  toggleFiles(paths) { this.rollbackRequest = null; this.controller.toggleFiles(paths); }

  confirmRollback(cx) {
    const request = this.rollbackRequest;
    this.rollbackRequest = null;
    if (!request || request.key !== this.confirmationKey()) return;
    this.start(cx, () => request.key === this.confirmationKey() ? this.controller.mutate({ type: "rollback", confirmed: true }) : Promise.resolve());
  }

  requestContext(cx) {
    if (!this.controller.transition()) return false;
    this.rollbackRequest = null;
    if (!this.contextWork) this.contextWork = cx.timer.after(0, (cx) => {
      this.contextWork = null;
      if (!this.controller.closed) this.start(cx, () => this.controller.refresh());
    });
    return true;
  }

  control(t, id, label, content, action, { disabled = false, primary = false } = {}) {
    const handle = this.handles[id];
    let el = h_flex().id(`${this.id}-${id}`).h(28).px(6).gap(4).items_center().justify_center().flex_none().rounded(UI.radius)
      .role("button").accessibility_label(label).disabled(disabled).text_size(11).font_medium()
      .text_color(primary ? t.solid_foreground : t.accent).when(primary, (e) => e.bg(t.solid))
      .when(disabled, (e) => e.opacity(0.5)).when(!disabled, (e) => e.cursor_pointer().hover((s) => primary ? s.opacity(0.9) : s.bg(t.hover)))
      .when(!disabled, (e) => e.on_click((_e, cx) => { cx.stop_propagation(); action(cx); cx.notify(); })).child(content);
    if (handle && !disabled) el = el.track_focus(handle).tab_index(0).on_key_down((e, cx) => {
      if (!handle.is_focused() || !["enter", "space"].includes(e.key)) return;
      cx.stop_propagation(); action(cx); cx.notify();
    }).when(handle.is_focused(), (e) => e.relative().child(div().absolute().inset_0().rounded(UI.radius).border(2).border_color(t.accent)));
    return el;
  }

  syncMessage() {
    const c = this.controller, draft = c.draft(), key = c.snapshot?.root ? repositoryKey(c.snapshot) : "";
    this.syncing = true;
    try {
      if (this.messageState.value() !== draft.message) this.messageState.set_value(draft.message);
      if (key !== this.inputRepository) { this.inputRepository = key; this.treeAt = 0; this.collapsed.clear(); }
    } finally { this.syncing = false; }
  }

  rows() {
    return treeRows(fileTree(this.controller.files()), this.collapsed, "changes");
  }

  activateRow(row, cx) {
    if (!row.file) this.toggle(this.collapsed, `changes:${row.path}`);
    else this.toggleFiles([row.path]);
    cx.notify();
  }
  toggle(set, key) { if (set.has(key)) set.delete(key); else set.add(key); }

  checkbox(t, id, label, checked, action, { disabled = false, partial = false, text } = {}) {
    const handle = this.handles[id];
    return Checkbox.new(`${this.id}-${id}`).checked(checked).disabled(disabled).accessibility_label(label)
      .when(Boolean(handle), (el) => el.track_focus(handle)).tab_index(disabled ? -1 : 0)
      .h(TREE_ROW).flex_none().px(3).flex().items_center().gap(6).rounded(UI.radius)
      .when(disabled, (el) => el.opacity(0.5))
      .when(!disabled, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)))
      .border(2).border_color(handle?.is_focused() && !disabled ? t.accent : "#00000000")
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => cx.stop_propagation())
      .on_change((_checked, cx) => { cx.stop_propagation(); if (!disabled) action(cx); cx.notify(); })
      .child(div().size(14).flex_none().flex().items_center().justify_center().rounded(2).border_1()
        .border_color(checked || partial ? t.accent : t.muted).bg(t.input).text_color(t.foreground).text_size(11)
        .child(checked ? "✓" : partial ? "−" : ""))
      .when(Boolean(text), (el) => el.child(text));
  }

  tree(t) {
    const rows = this.rows(), c = this.controller, files = c.files(), locked = c.busy || c.loading;
    const treeTheme = { ...t, dim: t.muted, ring: t.accent };
    const at = Math.max(0, Math.min(this.treeAt, rows.length - 1));
    const width = rows.reduce((max, row) => Math.max(max, 144 + row.depth * 27.2 + displayPath(row.name).length * UI.text), 240);
    const pathsOf = (row) => row.file ? [row.path] : files.filter((file) => file.path.startsWith(`${row.path}/`)).map((file) => file.path);
    const draw = (row, i) => {
      const paths = pathsOf(row), count = paths.filter((path) => c.checked.has(path)).length;
      const open = !this.collapsed.has(`changes:${row.path}`);
      return treeRow(treeTheme, "mods/t3-files",
        { name: displayPath(row.name), path: row.path, depth: row.depth, dir: !row.file, open }, `${this.id}-row-${row.file ? "file" : "folder"}-${row.path}`,
        { truncate: false, selected: count === paths.length,
          focused: this.handles.tree.is_focused() && i === at,
          leading: this.checkbox(t, row.file ? `check-${row.path}` : "folder-" + row.path,
            `${count && count !== paths.length ? "Partially selected. " : ""}Include ${displayPath(row.path)}`, count === paths.length,
            () => this.toggleFiles(paths), { disabled: locked, partial: count > 0 && count < paths.length }),
          trailing: row.file ? statusBadge(row.file.status).when(row.file.conflict, (el) => el.text_color(t.ansi1)) : null })
        .role("button").accessibility_label(row.file ? `${c.checked.has(row.path) ? "Exclude" : "Include"} ${displayPath(row.path)}, ${row.file.conflict ? "unresolved conflict" : row.file.status}` : `${open ? "Collapse" : "Expand"} folder ${displayPath(row.path)}`)
        .cursor_pointer().on_click((_e, cx) => { this.handles.tree.focus(); this.treeAt = i; this.activateRow(row, cx); });
    };
    return v_flex().w_full().flex_1().min_h(0).min_w(0)
      .child(h_flex().h(28).flex_none().px(8).items_center().gap(6)
        .child(this.checkbox(t, "all", "Include all changed files", files.length > 0 && files.every((file) => c.checked.has(file.path)),
          () => this.toggleFiles(files.map((file) => file.path)), { disabled: locked || !files.length,
            partial: c.checked.size > 0 && c.checked.size < files.length, text: "Changes" }))
        .child(div().text_color(t.muted).child(`${files.length} files · ${c.checked.size} selected`)))
      .child(div().flex_1().min_h(0).min_w(0).relative()
        .child(div().id(`${this.id}-tree-x`).absolute().inset_0().min_w(0).overflow_x_scroll()
          .child(div().w_full().min_w(width).h_full().track_focus(this.handles.tree).tab_index(0)
            .role("group").accessibility_label("Changed files. Arrows navigate, Enter toggles file inclusion or expands folders, Space toggles inclusion.")
            .on_key_down((e, cx) => {
              if (!this.handles.tree.is_focused()) return;
              const row = rows[at]; if (!row) return;
              if (["up", "down", "home", "end"].includes(e.key)) {
                this.treeAt = e.key === "home" ? 0 : e.key === "end" ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, at + (e.key === "down" ? 1 : -1)));
                this.treeScroll.scroll_to_item(this.treeAt);
              } else if (e.key === "enter") this.activateRow(row, cx);
              else if (e.key === "space" && !locked) this.toggleFiles(pathsOf(row));
              else if (["left", "right"].includes(e.key) && !row.file) {
                if (e.key === "left") this.collapsed.add(`changes:${row.path}`); else this.collapsed.delete(`changes:${row.path}`);
              } else return;
              cx.stop_propagation(); cx.notify();
            })
            .on_scroll_wheel((_e, cx) => cx.stop_propagation())
            .child(v_virtual_list(`${this.id}-tree-y`, rows.length, TREE_ROW, (i) => `${rows[i].file ? "file" : "folder"}:${rows[i].path}`,
              (range) => rows.slice(range.start, range.end).map((row, i) => draw(row, range.start + i)))
              .track_scroll(this.treeScroll).size_full())
            .when(!rows.length, (el) => el.child(div().absolute().inset_0().p(12).text_color(t.muted).child(this.emptyMessage())))))
        .child(Scrollbar.vertical(`${this.id}-tree-y`).mode("always").viewport_from_layout().absolute().inset_0()))
      .child(div().w_full().min_w(0).h(UI.scrollbar).flex_none().relative()
        .child(Scrollbar.horizontal(`${this.id}-tree-x`).mode("always").viewport_from_layout().absolute().inset_0()));
  }

  emptyMessage() {
    const c = this.controller, snapshot = c.snapshot;
    return c.loading ? "Loading changes…" : !snapshot || snapshot.state === "nofolder"
      ? "Focus a terminal in a repository, then refresh." : snapshot.state === "norepo"
      ? "This folder isn't a Git repository." : "Working tree clean";
  }

  commitFooter(t) {
    const c = this.controller, ready = c.snapshot?.state === "ready", locked = c.busy || c.loading;
    const conflict = c.snapshot?.files.some((file) => file.conflict), message = c.draft().message;
    const disabled = !ready || locked || conflict || (!c.checked.size && !c.amend) || !message.trim() || message.includes("\0");
    const height = Math.min(Math.max(210, this.height * 0.37), Math.max(130, this.height - 110));
    return v_flex().w_full().h(height).min_h(0).flex_none().p(10).gap(6).border_t(1).border_color(t.border).text_size(UI.text)
      .child(h_flex().h(TREE_ROW).flex_none().items_center().gap(8)
        .child(this.checkbox(t, "amend", "Amend previous commit", c.amend, (cx) => {
          this.rollbackRequest = null; this.start(cx, () => c.setAmend(!c.amend));
        }, { disabled: !ready || locked || !c.snapshot?.head, text: "Amend" }))
        .when(c.amend, (el) => el.child(div().text_color(t.muted).text_size(10).child("Rewrites HEAD; unchecked previous files remain in the commit"))))
      .child(Textarea.new(this.messageState).w_full().flex_1().min_h(0).px(10).py(6)
        .rounded(UI.commitRadius).bg(t.input).text_size(UI.text).line_height("20px").text_color(t.foreground)
        .border(2).border_color(this.messageFocused ? t.accent : t.border).accessibility_label("Commit message"))
      .child(h_flex().h(UI.commitHeight).flex_none().gap(8).items_center().overflow_x_scroll()
        .child(this.control(t, "commit", c.amend ? "Amend previous commit with selected changes" : "Commit selected changes", c.busy ? "Working…" : "Commit",
          (cx) => this.mutate(cx, { type: "commit" }), { primary: true, disabled }).h(UI.commitHeight).px(12))
        .child(this.control(t, "commit-push", "Commit selected changes and push", "Commit and push",
          (cx) => this.mutate(cx, { type: "commit", push: true }), { disabled }).h(UI.commitHeight).px(12)));
  }

  fileList(t) {
    const c = this.controller, locked = c.busy || c.loading, ready = c.snapshot?.state === "ready";
    const dirty = c.snapshot?.files.filter((file) => c.checked.has(file.path)) ?? [];
    const conflict = c.snapshot?.files.some((file) => file.conflict);
    return v_flex().w_full().flex_1().min_h(0).min_w(0)
      .child(h_flex().h(UI.header).flex_none().px(8).gap(4).items_center().overflow_x_scroll()
        .child(this.control(t, "refresh", "Refresh changes", "Refresh", (cx) => {
          this.rollbackRequest = null; this.start(cx, () => c.refresh());
        }, { disabled: locked }))
        .child(this.control(t, "stash", "Stash selected changed files", "Stash selected", (cx) => this.mutate(cx, { type: "stash" }),
          { disabled: !ready || locked || conflict || !dirty.length }))
        .child(this.control(t, "rollback", "Roll back selected changed files", "Rollback selected", () => {
          this.rollbackRequest = { key: this.confirmationKey(), count: dirty.length };
        }, { disabled: !ready || locked || conflict || !dirty.length })))
      .when(Boolean(this.rollbackRequest), (el) => el.child(v_flex().flex_none().px(10).py(6).gap(4).bg(t.raised)
        .child(div().text_color(t.ansi1).child(`Permanently discard changes in ${this.rollbackRequest.count} selected files? This can't be undone.`))
        .child(h_flex().gap(8)
          .child(this.control(t, "confirm-rollback", "Confirm permanent rollback of selected files", "Confirm rollback", (cx) => this.confirmRollback(cx), { disabled: locked }))
          .child(this.control(t, "cancel-rollback", "Cancel rollback", "Cancel", () => { this.rollbackRequest = null; })))))
      .when(Boolean(conflict), (el) => el.child(div().px(10).py(4).text_color(t.ansi1).child("Resolve conflicts outside Changes before committing, stashing, or rolling back.")))
      .when(locked, (el) => el.child(div().px(10).text_color(t.muted).child(c.busy ? "Updating repository…" : "Refreshing changes…")))
      .child(this.tree(t));
  }

  render(cx) {
    this.requestContext(cx);
    const t = theme();
    return v_flex().id(this.id).size_full().min_h(0).min_w(0).bg(t.background).text_color(t.foreground).text_size(UI.text)
      .track_focus(this.handle).on_key_down((e, cx) => {
        if (this.handle.is_focused() && ["down", "enter", "tab"].includes(e.key)) { this.handles.tree.focus(); cx.stop_propagation(); cx.notify(); }
      }).on_size_change((size, cx) => {
        const unit = Number(settings()?.zoom) || 1, width = size.width / unit, height = size.height / unit;
        if (width !== this.width || height !== this.height) { this.width = width; this.height = height; cx.notify(); }
      })
      .when(Boolean(this.controller.error), (el) => el.child(v_flex().w_full().max_h(100).flex_none().overflow_y_scrollbar().px(10).py(6).gap(4)
        .text_color(t.ansi1).child(this.controller.error)
        .child(div().text_color(t.muted).child("Check Git's message before trying again."))))
      .child(this.fileList(t))
      .child(this.commitFooter(t));
  }
}
