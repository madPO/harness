export interface PreviewRow { kind: "meta" | "hunk" | "add" | "remove" | "context"; old: number | null; next: number | null; text: string }
export interface Preview { state: "ready" | "empty" | "binary"; rows: PreviewRow[]; notice: string | null }
export interface LayoutNode { id?: string; hidden?: boolean; active?: string; children?: LayoutNode[] }
export const PREVIEW_LIMITS: { rows: number; line: number };
export function wideChanges(root: LayoutNode | null | undefined): boolean;
export function parsePreview(text: string): Preview;
