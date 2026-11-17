import type { Branch, Snapshot } from "./model.js";
import type { Exec } from "./git.js";

export interface ActionContext {
  snapshot: Snapshot;
  branch: Branch;
  head: string | null;
  current: string | null;
  target: string;
  remote: string | null;
  remoteBranch: string | null;
  localExists: boolean;
  /** Serialized eligible history, populated by readRebaseTodo and preserved through overlay props. */
  rebaseHistory?: string;
}
export interface ActionItem { type: string; label: string; danger?: boolean }
export interface ActionValues { name?: string; message?: string; force?: boolean; todo?: string }
/** Capture exact refs and repository identity. The returned context supports JSON roundtrips between overlays. */
export function readActionContext(snapshot: Snapshot, branch: Branch, exec: Exec): Promise<ActionContext>;
export function actionItems(ctx: ActionContext, pinned: boolean): ActionItem[];
/** Populate ctx.rebaseHistory and return an editable linear-history todo containing full commit IDs. */
export function readRebaseTodo(ctx: ActionContext, exec: Exec): Promise<string>;
/** Reject stale contexts and invalid values. Git conflicts remain available for manual resolution. */
export function executeBranchAction(type: string, values: ActionValues, ctx: ActionContext, exec: Exec): Promise<void>;
