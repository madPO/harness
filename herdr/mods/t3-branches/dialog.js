import { div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, TextareaState, Textarea, Checkbox } from "gpui-base";
import { props, theme, closeOverlay, exec } from "herdr";
import { readRebaseTodo } from "./actions.js";
import { assertOrigin, perform, problem } from "./menu.js";

function detail(type, ctx) {
  const selected = ctx.branch.name, current = ctx.current ?? "detached HEAD";
  if (type === "checkout") return `Create and check out a local branch tracking ${selected}. Choose an unused local name.`;
  if (type === "merge") return `Merge ${selected} into ${current}. Git may leave conflicts for you to resolve.`;
  if (type === "rebase" || type === "interactiveRebase") return `Rebase ${current} onto ${selected}. This rewrites current branch history. Git may leave conflicts for you to resolve.`;
  if (type === "createBranch") return `Create a local branch at ${selected}. Your current checkout won't change.`;
  if (type === "addTag") return `Create a tag at ${selected}. An optional message creates an annotated tag.`;
  if (type === "deleteBranch") return ctx.branch.kind === "remote"
    ? `Delete ${ctx.remoteBranch} from the shared ${ctx.remote} server. This contacts the remote and affects collaborators.`
    : `Delete local branch ${selected}. This doesn't delete a branch on any remote server.`;
  return "";
}

export class Dialog {
  init(cx) {
    const { type, ctx } = props();
    // Keep the serialized history capture added by readRebaseTodo through confirmation.
    this.ctx = ctx;
    this.values = type === "deleteBranch" && ctx.branch.kind === "local" ? { force: false } : {};
    this.handle = cx.focus_handle();
    this.handles = Object.fromEntries(["cancel", "confirm", "force"].map((id) => [id, cx.focus_handle()]));
    this.fields = [];
    this.inputFocus = null;
    this.error = null;
    const field = (id, label, value = "") => {
      const state = InputState.new({ value });
      this.values[id] = value;
      state.on("change", (_e, cx) => { this.values[id] = state.value(); cx.notify(); });
      state.on("submit", (_e, cx) => this.confirm(cx));
      state.on("focus", (_e, cx) => { this.inputFocus = id; cx.notify(); });
      state.on("blur", (_e, cx) => { if (this.inputFocus === id) this.inputFocus = null; cx.notify(); });
      this.fields.push({ id, label, state });
    };
    if (["createBranch", "addTag", "checkout"].includes(type)) {
      field("name", type === "addTag" ? "Tag name" : "Local branch name", type === "checkout" ? ctx.remoteBranch ?? "" : "");
    }
    if (type === "addTag") field("message", "Tag message (optional)");
    if (type === "interactiveRebase") {
      this.loading = true;
      this.todo = TextareaState.new({ value: "", placeholder: "Loading commits…", rows: 10 });
      this.todo.set_soft_wrap(false);
      this.todo.on("change", (_e, cx) => { this.values.todo = this.todo.value(); cx.notify(); });
      this.todo.on("focus", (_e, cx) => { this.inputFocus = "todo"; cx.notify(); });
      this.todo.on("blur", (_e, cx) => { this.inputFocus = null; cx.notify(); });
      cx.spawn(async (cx) => {
        try {
          assertOrigin(props().origin);
          const todo = await readRebaseTodo(ctx, exec);
          if (this.closed) return;
          assertOrigin(props().origin);
          this.values.todo = todo;
          this.todo.set_value(todo);
          this.todoReady = true;
          this.todo.focus();
        } catch (error) { if (!this.closed) this.error = problem(error); }
        finally { this.loading = false; if (!this.closed) cx.notify(); }
      });
    }
    (this.fields[0]?.state ?? this.handle).focus();
    this.watch = cx.timer.every(100, (cx) => {
      if (this.closed) return;
      const at = Object.keys(this.handles).find((id) => this.handles[id].is_focused());
      if (at !== this.focusedControl) { this.focusedControl = at; cx.notify(); }
    });
  }

  close() {
    this.closed = true;
    this.watch?.cancel();
    this.fields.forEach(({ state }) => state.release());
    this.todo?.release();
  }

  confirm(cx) {
    if (this.busy || this.loading || (this.todo && !this.todoReady)) return;
    const { type, origin, overlay } = props(), ctx = this.ctx;
    try { assertOrigin(origin); }
    catch (error) { this.error = problem(error); cx.notify(); return; }
    if (this.fields.some(({ id }) => id === "name" && !this.values.name?.trim())) {
      this.error = "Enter a name before continuing."; cx.notify(); return;
    }
    const values = { ...this.values };
    this.busy = true;
    this.error = null;
    cx.spawn(async (cx) => {
      try {
        await perform(type, values, ctx, origin);
        if (!this.closed) closeOverlay(overlay);
      } catch (error) { if (!this.closed) this.error = problem(error); }
      finally { this.busy = false; if (!this.closed) cx.notify(); }
    });
    cx.notify();
  }

  button(t, id, label, primary, cxAction, disabled) {
    const handle = this.handles[id];
    return h_flex().id(`branch-dialog-${id}`).h(32).px(12).items_center().justify_center().rounded(5).relative()
      .role("button").accessibility_label(label).disabled(disabled).text_size(12).font_medium()
      .bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground)
      .when(disabled, (el) => el.opacity(0.5))
      .when(!disabled, (el) => el.track_focus(handle).tab_index(0).cursor_pointer().hover((s) => s.bg(primary ? t.solid : t.hover))
        .on_click((_e, cx) => cxAction(cx)).on_key_down((e, cx) => {
          if (!handle.is_focused() || !["enter", "space"].includes(e.key)) return;
          cx.stop_propagation(); cxAction(cx); cx.notify();
        }))
      .child(label)
      .when(!disabled && handle.is_focused(), (el) => el.child(div().absolute().inset_0().rounded(5).border(2).border_color(t.accent)));
  }

  render() {
    const { type, ctx, label } = props(), t = theme(), locked = Boolean(this.busy || this.loading);
    const confirmDisabled = locked || Boolean(this.todo && !this.todoReady);
    return v_flex().id("branch-action-dialog").track_focus(this.handle).size_full().min_h(0).p(18).gap(12)
      .bg(t.popover).text_color(t.foreground).text_size(12).role("dialog").accessibility_label(label)
      .on_key_down((e, cx) => {
        if (e.key === "escape" && !this.busy) closeOverlay(props().overlay);
        else if (e.key === "enter" && this.handle.is_focused() && !this.todo) this.confirm(cx);
        else return;
        cx.stop_propagation(); cx.notify();
      })
      .child(div().text_size(15).font_semibold().text_color(type === "deleteBranch" ? t.ansi1 : t.foreground).child(label))
      .child(v_flex().flex_1().min_h(0).gap(12).overflow_y_scrollbar()
        .child(div().text_color(t.muted).child(detail(type, ctx)))
        .when(type === "checkout" && ctx.localExists, (el) => el.child(div().role("alert").text_color(t.ansi1)
          .child("That local branch name already exists. Choose a different name; existing branches won't be checked out.")))
        .children(this.fields.map(({ id, label, state }) => v_flex().gap(6).flex_none()
          .child(div().child(label))
          .child(Input.new(state).h(36).px(10).rounded(5).border(2).bg(t.input).text_color(t.foreground)
            .border_color(this.inputFocus === id ? t.accent : t.border).disabled(locked).accessibility_label(label))))
        .when(type === "deleteBranch" && ctx.branch.kind === "local", (el) => el.child(Checkbox.new("branch-delete-force")
          .checked(this.values.force).disabled(locked).track_focus(this.handles.force).tab_index(locked ? -1 : 0)
          .accessibility_label("Force delete local branch, including unmerged commits").h(32).gap(8).rounded(5)
          .when(this.handles.force.is_focused(), (el) => el.border(2).border_color(t.accent))
          .when(!locked, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)))
          .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
          .on_change((_checked, cx) => {
            cx.stop_propagation();
            if (!locked) this.values.force = !this.values.force;
            cx.notify();
          })
          .child(div().size(14).flex_none().flex().items_center().justify_center().rounded(2).border_1()
            .border_color(t.muted).bg(t.input).child(this.values.force ? "✓" : ""))
          .child("Force delete, including unmerged commits")))
        .when(Boolean(this.todo), (el) => el
          .child(div().text_color(t.muted).child("Use pick, drop, squash, or fixup. Reorder lines to reorder commits. Only listed commits are allowed. No exec, edit, or reword."))
          .child(Textarea.new(this.todo).w_full().h(230).flex_none().px(10).py(6).rounded(5).bg(t.input)
            .text_color(t.foreground).text_size(12).border(2).border_color(this.inputFocus === "todo" ? t.accent : t.border)
            .disabled(locked || !this.todoReady).accessibility_label("Interactive rebase todo")))
        .when(Boolean(this.loading), (el) => el.child(div().text_color(t.muted).child("Loading eligible commits…")))
        .when(Boolean(this.error), (el) => el.child(v_flex().gap(6).role("alert").child(div().text_color(t.ansi1).child(this.error))
          .child(div().text_color(t.muted).child("Read Git's message before retrying. Resolve or abort conflicts outside Branches; no automatic reset or abort occurs.")))))
      .child(h_flex().flex_none().gap(8).justify_end()
        .child(this.button(t, "cancel", "Cancel", false, () => closeOverlay(props().overlay), Boolean(this.busy)))
        .child(this.button(t, "confirm", this.busy ? "Working…" : label, true, (cx) => this.confirm(cx), confirmDisabled)));
  }
}
