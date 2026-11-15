export interface SpaceContext { id: string; active?: boolean; folder?: string | null; machine?: string | null; tabs?: { id: string }[] }
export interface PaneContext { pane: string; tab: string; cwd?: string | null }
export interface FocusContext { space: string; tab: string; pane: string | null; cwd?: string | null; terminal?: string | null }
export interface ResolvedContext { space: string | null; cwd: string | null; on: string | null }
export function resolveContext(spaces: SpaceContext[], panes: PaneContext[], focused: FocusContext | null | undefined): ResolvedContext;
