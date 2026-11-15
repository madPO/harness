import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, Input, InputState, Scrollbar, v_virtual_list } from "gpui-base";
import { spaces, panes, focused, exec, theme, settings, setShared } from "herdr";
import { ChangesController } from "./controller.js";
import { displayPath, contextKey, repositoryKey, selectionKey, fileTree, treeRows } from "./model.js";
import { TREE_ROW, treeRow, statusBadge } from "./tree-row.js";

const UI = { sidebar: 264, narrow: 560, header: 76, diffRow: 24, text: 12, code: 12, radius: 5 };
function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}

export default class Changes extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handles = Object.fromEntries(["refresh", "unstaged", "staged", "stage-all", "unstage-all", "commit", "tree"].map((id) => [id, cx.focus_handle()]));
    this.collapsed = new Set(); this.folded = new Set(); this.width = 900; this.height = 600; this.treeTop = 0; this.treeHeight = 240;
    this.id = `t3-changes-${Math.random().toString(36).slice(2)}`;
    this.controller = new ChangesController({ exec, location, changed: () => cx.notify(), publish: () => setShared("git-graph.changed", Date.now()) });
    this.inputs = Object.fromEntries(["subject", "description"].map((field) => {
      const state = InputState.new({ placeholder: field === "subject" ? "Commit subject" : "Add more detail…", value: "" });
      state.on("change", (_e, cx) => { if (!this.syncing) this.controller.setDraft(field, state.value()); cx.notify(); });
      state.on("focus", (_e, cx) => { this.inputFocus = field; cx.notify(); });
      state.on("blur", (_e, cx) => { if (this.inputFocus === field) this.inputFocus = null; cx.notify(); });
      // Neither field submits a commit accidentally. Commit is an explicit action.
      return [field, state];
    }));
    this.start(cx, () => this.controller.refresh());
    this.focusWatch = cx.timer.every(150, (cx) => {
      const key = Object.entries(this.handles).find(([, handle]) => handle.is_focused())?.[0];
      if (key !== this.focusedControl) { this.focusedControl = key; cx.notify(); }
    });
  }

  close() { this.controller.close(); this.focusWatch?.cancel(); }
  start(cx, action) { cx.spawn(async () => { await action(); }); }
  mutate(cx, action) { this.start(cx, () => this.controller.mutate(action)); }

  control(t, id, label, content, action, { disabled = false, primary = false } = {}) {
    const handle = this.handles[id];
    let el = h_flex().id(`${this.id}-${id}`).h(28).px(6).gap(4).items_center().justify_center().flex_none().rounded(UI.radius)
      .role("button").accessibility_label(label).text_size(11).font_medium()
      .text_color(primary ? t.solid_foreground : t.accent).when(primary, (e) => e.bg(t.solid))
      .when(disabled, (e) => e.opacity(0.5)).when(!disabled, (e) => e.cursor_pointer().hover((s) => primary ? s.opacity(0.9) : s.bg(t.hover)))
      .when(!disabled, (e) => e.on_click((_e, cx) => { cx.stop_propagation(); action(cx); cx.notify(); })).child(content);
    if (handle && !disabled) el = el.track_focus(handle).tab_index(0).on_key_down((e, cx) => {
      if (!handle.is_focused() || !["enter", "space"].includes(e.key)) return;
      cx.stop_propagation(); action(cx); cx.notify();
    }).when(handle.is_focused(), (e) => e.relative().child(div().absolute().inset_0().rounded(UI.radius).border(2).border_color(t.accent)));
    return el;
  }

  syncInputs() {
    const c = this.controller, draft = c.draft(), key = c.snapshot?.root ? repositoryKey(c.snapshot) : "";
    this.syncing = true;
    try {
      for (const field of ["subject", "description"]) if (this.inputs[field].value() !== draft[field]) this.inputs[field].set_value(draft[field]);
      if (key !== this.inputRepository) { this.inputRepository = key; this.treeTop = 0; this.treeAt = 0; }
    } finally { this.syncing = false; }
  }

  rows() {
    const groups = this.controller.snapshot?.groups ?? { unstaged: [], staged: [] };
    return ["unstaged", "staged"].flatMap((group) => [{ kind: "group", group }, ...(!this.folded.has(group)
      ? treeRows(fileTree(groups[group]), this.collapsed, group).map((row) => ({ ...row, group, kind: row.file ? "file" : "folder" })) : [])]);
  }

  activateRow(row, cx) {
    if (row.kind === "group") this.toggle(this.folded, row.group);
    else if (row.kind === "folder") this.toggle(this.collapsed, `${row.group}:${row.path}`);
    else this.start(cx, () => this.controller.select(row.file));
    cx.notify();
  }
  toggle(set, key) { if (set.has(key)) set.delete(key); else set.add(key); }

  tree(t) {
    const rows = this.rows(), c = this.controller, groups = c.snapshot?.groups ?? { unstaged: [], staged: [] };
    const treeTheme = { ...t, dim: t.muted, ring: t.accent };
    const total = rows.length * TREE_ROW, max = Math.max(0, total - this.treeHeight);
    this.treeTop = Math.max(0, Math.min(this.treeTop, max));
    const first = Math.floor(this.treeTop / TREE_ROW), end = Math.min(rows.length, Math.ceil((this.treeTop + this.treeHeight) / TREE_ROW) + 1);
    const at = Math.max(0, Math.min(this.treeAt ?? 0, rows.length - 1));
    const draw = (row, i) => {
      let el;
      if (row.kind === "group") {
        const title = row.group === "staged" ? "Staged" : "Unstaged", files = groups[row.group];
        const toggle = this.control(t, row.group, `${this.folded.has(row.group) ? "Expand" : "Collapse"} ${title}`,
          h_flex().items_center().gap(4.8)
            .child(div().size(16).flex_none().flex().items_center().justify_center()
              .child(svg(`mods/t3-files/icons/chevron-${this.folded.has(row.group) ? "right" : "down"}.svg`).size(12).text_color(t.muted)))
            .child(title), () => this.toggle(this.folded, row.group)).h(TREE_ROW);
        el = h_flex().items_center().px(8).gap(4).when(row.group === "staged", (e) => e.border_t(1).border_color(t.border))
          .child(toggle.text_color(t.foreground)).child(div().flex_1())
          .child(this.control(t, row.group === "staged" ? "unstage-all" : "stage-all", row.group === "staged" ? "Unstage all files" : "Stage all files",
            row.group === "staged" ? "Unstage all" : "Stage all", (cx) => this.mutate(cx, { type: row.group === "staged" ? "unstage" : "stage" }),
            { disabled: c.busy || c.loading || !files.length || row.group === "unstaged" && files.some((file) => file.conflict) }).h(TREE_ROW))
          .child(div().w(18).text_right().text_color(t.muted).text_size(10).child(String(files.length)));
      } else {
        const selected = Boolean(row.file && selectionKey(c.selected) === selectionKey(row.file));
        const open = !this.collapsed.has(`${row.group}:${row.path}`);
        const action = row.file ? this.control(t, `file-action-${i}`,
          `${row.group === "staged" ? "Unstage" : "Stage"} ${displayPath(row.path)} (Space on selected file)`, row.group === "staged" ? "−" : "+",
          (cx) => this.mutate(cx, { type: row.group === "staged" ? "unstage" : "stage", path: row.path }),
          { disabled: c.busy || c.loading || row.file.conflict })
          .h(20).w(20).px(0).on_mouse_down("left", (_e, cx) => cx.stop_propagation()) : null;
        const badge = row.file ? statusBadge(row.file.status)
          .when(row.file.conflict, (e) => e.text_color(t.ansi1).bg(t.ansi1 + "1a")) : div().size(16).flex_none();
        el = treeRow(treeTheme, "mods/t3-files",
          { name: displayPath(row.name), path: row.path, depth: row.depth, dir: !row.file, open }, `${this.id}-row-${i}`,
          { selected, focused: this.handles.tree.is_focused() && i === at,
            trailing: h_flex().items_center().gap(4.8).flex_none()
              .child(badge).child(div().size(20).flex_none().flex().items_center().justify_center().when(Boolean(action), (e) => e.child(action))) })
          .role("button").accessibility_label(row.file ? `${row.group}: ${displayPath(row.path)}, ${row.file.conflict ? "unresolved conflict" : row.file.status}` : `${open ? "Collapse" : "Expand"} folder ${displayPath(row.path)}`)
          .cursor_pointer().on_click((_e, cx) => { this.treeAt = i; this.activateRow(row, cx); });
      }
      return el.absolute().left(8).right(8).top(i * TREE_ROW - this.treeTop).h(TREE_ROW).text_size(UI.text)
        .when(row.kind === "group" && this.handles.tree.is_focused() && i === at, (e) => e.rounded(UI.radius).border(2).border_color(t.accent));
    };
    return div().id(`${this.id}-tree`).relative().flex_1().min_h(56).overflow_hidden().track_focus(this.handles.tree).tab_index(0)
      .role("group").accessibility_label("Changed files. Arrow keys navigate, Enter selects or expands, Space stages or unstages a file.")
      .on_mouse_down("left", () => this.handles.tree.focus())
      .on_size_change((size, cx) => { const height = size.height / (Number(settings()?.zoom) || 1); if (height !== this.treeHeight) { this.treeHeight = height; cx.notify(); } })
      .on_scroll_wheel((e, cx) => { cx.stop_propagation(); this.treeTop = Math.max(0, Math.min(max, this.treeTop - e.delta.y / (Number(settings()?.zoom) || 1))); cx.notify(); })
      .on_key_down((e, cx) => {
        if (!this.handles.tree.is_focused()) return;
        const row = rows[at]; if (!row) return;
        if (["up", "down", "home", "end"].includes(e.key)) {
          this.treeAt = e.key === "home" ? 0 : e.key === "end" ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, at + (e.key === "down" ? 1 : -1)));
          this.treeTop = Math.max(0, Math.min(max, this.treeTop, this.treeAt * TREE_ROW), (this.treeAt + 1) * TREE_ROW - this.treeHeight);
        } else if (e.key === "enter") this.activateRow(row, cx);
        else if (e.key === "space" && row.file && !row.file.conflict) this.mutate(cx, { type: row.group === "staged" ? "unstage" : "stage", path: row.path });
        else if (["left", "right"].includes(e.key) && !row.file) {
          const set = row.kind === "group" ? this.folded : this.collapsed, key = row.kind === "group" ? row.group : `${row.group}:${row.path}`;
          if (e.key === "left") set.add(key); else set.delete(key);
        } else return;
        cx.stop_propagation(); cx.notify();
      }).children(rows.slice(first, end).map((row, i) => draw(row, first + i)));
  }

  commitForm(t) {
    const c = this.controller, ready = c.snapshot?.state === "ready", staged = c.snapshot?.groups.staged.length ?? 0;
    const conflict = c.snapshot?.files.some((file) => file.conflict);
    const field = (name, title, height) => v_flex().gap(7)
      .child(h_flex().items_center().child(div().font_medium().child(title)).child(div().flex_1())
        .when(name === "description", (e) => e.child(div().text_size(10).text_color(t.muted).child("Optional"))))
      .child(Input.new(this.inputs[name]).h(height).px(10).rounded(UI.radius).bg(t.input).text_size(11).text_color(t.foreground)
        .border(this.inputFocus === name ? 2 : 1).border_color(this.inputFocus === name ? t.accent : t.input).accessibility_label(`Commit ${name}`));
    return v_flex().flex_none().p(18).gap(12).border_t(1).border_color(t.border).text_size(11)
      .child(field("subject", "Subject", 36)).child(field("description", "Description", 52))
      .when(Boolean(conflict), (e) => e.child(div().text_color(t.ansi1).child("Resolve conflicts outside Changes before staging or committing.")))
      .when(Boolean(ready && !staged), (e) => e.child(div().text_color(t.muted).text_size(10).child("Stage files to include them in the commit.")))
      .child(this.control(t, "commit", "Commit staged changes only", c.busy ? "Working…" : "Commit", (cx) => this.mutate(cx, { type: "commit" }),
        { primary: true, disabled: !ready || c.busy || c.loading || conflict || !staged || !c.draft().subject.trim() }).h(36).w_full());
  }

  sidebar(t, narrow) {
    const c = this.controller, count = c.snapshot?.files.length ?? 0;
    return v_flex().min_h(0).when(!narrow, (e) => e.w(UI.sidebar).h_full().flex_none().border_l(1).border_color(t.border))
      .when(narrow, (e) => e.w_full().h(Math.max(460, this.height * 0.53)).flex_none().border_t(1).border_color(t.border))
      .child(h_flex().h(UI.header).flex_none().px(18).gap(12).items_center().child(div().font_semibold().child("Changes"))
        .child(div().px(7).py(3).rounded(4).bg(t.raised).text_size(10).child(String(count))).child(div().flex_1())
        .child(this.control(t, "refresh", "Refresh changes", svg("mods/git-graph/icons/refresh.svg").size(14), (cx) => this.start(cx, () => c.refresh()), { disabled: c.loading || c.busy })))
      .when(c.busy, (e) => e.child(div().px(18).pb(6).text_size(10).text_color(t.muted).child("Updating repository…")))
      .child(this.tree(t)).child(this.commitForm(t));
  }

  diffRow(row, t) {
    if (row.kind === "hunk" || row.kind === "note") return h_flex().w_full().h(UI.diffRow).flex_none().px(20).items_center()
      .text_color(row.kind === "hunk" ? t.accent : t.muted).child(row.text);
    return h_flex().w_full().h(UI.diffRow).flex_none().items_center().whitespace_nowrap()
      .when(row.kind === "+", (e) => e.bg(t.ansi2 + "22")).when(row.kind === "-", (e) => e.bg(t.ansi1 + "22"))
      .child(div().w(34).flex_none().text_right().text_color(t.muted).text_size(10).child(row.old === undefined ? "" : String(row.old)))
      .child(div().w(28).flex_none().text_right().text_color(t.muted).text_size(10).child(row.next === undefined ? "" : String(row.next)))
      .child(div().w(24).flex_none().text_right().pr(6).text_color(row.kind === "+" ? t.ansi2 : row.kind === "-" ? t.ansi1 : t.muted).child(row.kind.trim()))
      .child(div().flex_none().text_color(t.foreground).child(row.text.replace(/\t/g, "    ")));
  }

  diff(t, narrow) {
    const c = this.controller, file = c.selected, snapshot = c.snapshot;
    const rows = c.diff === null ? null : c.diff.filter((row) => row.kind !== "hunk"
      && !(row.kind === "note" && /^(old mode|new mode|new file mode|deleted file mode) /.test(row.text)));
    let message = !snapshot ? c.loading ? "Loading changes…" : "Focus a terminal in a repository, then refresh." : snapshot.state === "nofolder" ? "Focus a terminal to see changes in its repository."
      : snapshot.state === "norepo" ? "This folder isn't a Git repository. Focus a terminal in a checkout." : !snapshot.files.length ? "Working tree clean" : !file ? "Select a changed file" : "Loading diff…";
    const width = rows ? rows.reduce((max, row) => Math.max(max, 100 + row.text.replace(/\t/g, "    ").length * UI.code), 320) : 320;
    return v_flex().min_w(0)
      .when(!narrow, (e) => e.flex_1().h_full().min_h(0))
      .when(narrow, (e) => e.w_full().h(Math.max(240, this.height * 0.47)).flex_none())
      .child(h_flex().h(UI.header).flex_none().px(20).gap(10).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().min_w(0).truncate().font_semibold().child(file ? displayPath(file.path) : "Changes")))
      .when(Boolean(c.error), (e) => e.child(v_flex().max_h(120).overflow_y_scrollbar().p(14).gap(6).text_color(t.ansi1)
        .child("Git couldn't complete the request").child(c.error).child(div().text_color(t.muted).child("Check Git's message, then refresh or try again. Your commit draft is unchanged."))))
      .child(div().flex_1().min_h(0).relative().font_family(settings()?.font_family ?? "JetBrains Mono").text_size(UI.code)
        .when(!rows, (e) => e.child(div().p(20).text_color(t.muted).child(message)))
        .when(Boolean(rows), (e) => e.child(div().id(`${this.id}-diff-x`).size_full().overflow_x_scrollbar()
          .child(div().w_full().min_w(width).h_full().child(v_virtual_list(`${this.id}-diff`, rows.length, UI.diffRow, (i) => String(i),
            (range) => rows.slice(range.start, range.end).map((row) => this.diffRow(row, t))).size_full())))
          .child(Scrollbar.vertical(`${this.id}-diff`).viewport_from_layout().absolute().inset_0())));
  }

  render(cx) {
    const c = this.controller;
    if (contextKey(location()) !== c.context) this.start(cx, () => c.refresh());
    this.syncInputs();
    const t = theme(), narrow = this.width < UI.narrow;
    return (narrow ? v_flex() : h_flex()).id(this.id).size_full().min_h(0).min_w(0).items_start().bg(t.background).text_color(t.foreground).text_size(UI.text)
      .track_focus(this.handle).on_key_down((e, cx) => {
        if (this.handle.is_focused() && ["down", "enter", "tab"].includes(e.key)) { this.handles.tree.focus(); cx.stop_propagation(); cx.notify(); }
      }).on_size_change((size, cx) => {
        const unit = Number(settings()?.zoom) || 1, width = size.width / unit, height = size.height / unit;
        if (width !== this.width || height !== this.height) { this.width = width; this.height = height; cx.notify(); }
      }).when(narrow, (e) => e.overflow_y_scrollbar())
      .child(this.diff(t, narrow)).child(this.sidebar(t, narrow));
  }
}
