export interface SpaceSnapshot {
  id: string;
  active?: boolean;
  folder?: string | null;
  machine?: string | null;
  tabs?: readonly { id: string }[];
}

export interface PaneSnapshot {
  pane: string;
  tab: string;
  cwd?: string | null;
  mod?: string;
}

export interface FocusSnapshot {
  space: string;
  tab: string;
  pane: string | null;
  cwd?: string | null;
  terminal?: string | null;
}

export interface FilesContext {
  space: string | null;
  cwd: string | null;
  on: string | null;
}

export function resolveContext(
  spaces: readonly SpaceSnapshot[],
  panes: readonly PaneSnapshot[],
  focused: FocusSnapshot | null | undefined,
): FilesContext;
