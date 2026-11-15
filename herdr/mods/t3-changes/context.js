// Resolve one coherent live focus snapshot without borrowing another space's cwd.
export function resolveContext(spaces, panes, focused) {
  const space = spaces.find((space) => space.id === focused?.space) ?? spaces.find((space) => space.active);
  if (!space) return { space: null, cwd: null, on: null };
  const matches = focused?.space === space.id;
  const pane = matches && focused.pane && space.tabs?.some((tab) => tab.id === focused.tab)
    ? panes.find((pane) => pane.pane === focused.pane && pane.tab === focused.tab) : null;
  const on = matches && focused.pane === null
    ? (focused.terminal?.includes("/") ? focused.terminal.split("/")[0] : null) : space.machine ?? null;
  return { space: space.id, cwd: pane?.cwd || (matches ? focused.cwd : null) || space.folder || null, on };
}
