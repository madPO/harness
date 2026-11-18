import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { props, theme, closeOverlay, openOverlay, exec, spaces, panes, focused, shared, setShared } from "herdr";
import { actionItems, executeBranchAction } from "./actions.js";
import { contextKey, repositoryKey } from "./model.js";
import { resolveContext } from "./context.js";

export const ownerKey = (view) => `t3-branches.owner:${view}`;
export const requestKey = (view) => `t3-branches.pin:${view}`;
export const resultKey = (view) => `t3-branches.pin-result:${view}`;
export const problem = (error) => error instanceof Error ? error.message : String(error);
const signalId = () => `${Date.now()}:${Math.random().toString(36).slice(2)}`;

export function assertOrigin(origin) {
  const owner = origin && shared(ownerKey(origin.view));
  const current = contextKey(resolveContext(spaces(), panes(), focused()));
  if (!owner || owner.key !== origin.key || owner.epoch !== origin.epoch || owner.repo !== origin.repo || current !== origin.key) {
    throw new Error("The focused repository or branch view changed. Close this window and reopen branch actions.");
  }
}

// Always publish, including Git conflicts. The owning view consumes this outside render.
export async function perform(type, values, ctx, origin) {
  assertOrigin(origin);
  try {
    await executeBranchAction(type, values, ctx, exec);
  } finally {
    setShared("git-graph.changed", Date.now());
    setShared("t3-branches.changed", { id: signalId(), repo: repositoryKey(ctx.snapshot) });
  }
}

export class Menu {
  init(cx) {
    const { ctx, pinned } = props();
    this.items = actionItems(ctx, pinned);
    this.at = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.watch = cx.timer.every(100, (cx) => {
      if (this.closed) return;
      if (this.pinRequest) {
        const result = shared(resultKey(props().origin.view));
        if (result?.id === this.pinRequest) {
          this.pinRequest = null;
          this.busy = false;
          if (result.error) this.error = result.error;
          else closeOverlay(props().overlay);
          cx.notify();
        }
        if (this.pinRequest) {
          try { assertOrigin(props().origin); }
          catch (error) {
            this.pinRequest = null;
            this.busy = false;
            this.error = problem(error);
            cx.notify();
          }
        }
      }
      if (this.focused !== this.handle.is_focused()) { this.focused = this.handle.is_focused(); cx.notify(); }
    });
  }

  close() { this.closed = true; this.watch?.cancel(); }

  choose(i, cx) {
    if (this.busy || !this.items[i]) return;
    const { ctx, origin, overlay } = props(), item = this.items[i];
    try {
      assertOrigin(origin);
      if (item.type === "copy") {
        cx.write_to_clipboard(ctx.branch.name);
        closeOverlay(overlay);
      } else if (item.type === "pin") {
        this.busy = true;
        this.pinRequest = signalId();
        setShared(requestKey(origin.view), { ...origin, id: this.pinRequest, ref: ctx.branch.ref });
      } else if (item.type === "checkout" && ctx.branch.kind === "local") {
        this.busy = true;
        this.error = null;
        cx.spawn(async (cx) => {
          try {
            await perform(item.type, {}, ctx, origin);
            closeOverlay(overlay);
          } catch (error) {
            this.error = problem(error);
          } finally {
            this.busy = false;
            if (!this.closed) cx.notify();
          }
        });
      } else {
        openOverlay({ mod: "t3-branches", kind: "dialog", width: item.type === "interactiveRebase" ? 620 : 480,
          height: item.type === "interactiveRebase" ? 620 : item.type === "addTag" ? 430 : 360,
          props: { role: "dialog", type: item.type, label: item.label, ctx, origin } });
        closeOverlay(overlay);
      }
    } catch (error) { this.error = problem(error); }
    cx.notify();
  }

  render() {
    const t = theme();
    return v_flex().id("branch-actions-menu").track_focus(this.handle).w_full().min_h(0).max_h(520)
      .p(6).bg(t.popover).text_color(t.foreground).text_size(12).role("menu").accessibility_label("Branch actions")
      .on_key_down((e, cx) => {
        if (e.key === "escape" && !this.busy) closeOverlay(props().overlay);
        else if (this.busy) return;
        else if (e.key === "down") this.at = (this.at + 1) % this.items.length;
        else if (e.key === "up") this.at = (this.at + this.items.length - 1) % this.items.length;
        else if (e.key === "home") this.at = 0;
        else if (e.key === "end") this.at = this.items.length - 1;
        else if (e.key === "enter" || e.key === "space") this.choose(this.at, cx);
        else return;
        cx.stop_propagation(); cx.notify();
      })
      .child(v_flex().min_h(0).overflow_y_scrollbar().children(this.items.map((item, i) => h_flex()
        .id(`branch-action-${item.type}`).h(30).flex_none().px(8).rounded(5).items_center().relative()
        .role("menu_item").accessibility_label(item.label).disabled(Boolean(this.busy))
        .text_color(item.danger ? t.ansi1 : t.foreground)
        .when(i === this.at, (el) => el.bg(t.selected))
        .when(!this.busy, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.choose(i, cx)))
        .when(Boolean(this.busy), (el) => el.opacity(0.5))
        .child(div().flex_1().min_w(0).child(item.label))
        .when(i === this.at && this.handle.is_focused(), (el) => el.child(div().absolute().inset_0().rounded(5).border(2).border_color(t.accent))))))
      .when(Boolean(this.busy), (el) => el.child(div().px(8).py(6).text_color(t.muted).child("Working…")))
      .when(Boolean(this.error), (el) => el.child(div().max_h(130).overflow_y_scrollbar().px(8).py(6).role("alert")
        .text_color(t.ansi1).child(this.error)));
  }
}
