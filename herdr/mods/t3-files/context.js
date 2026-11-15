// Resolve live window focus before the eventually updated active-space snapshot.
// A pane from another tab must never lend its cwd to this space's machine.
export function resolveContext(spaces, panes, focused) {
  const space = spaces.find((s) => s.id === focused?.space) ?? spaces.find((s) => s.active);
  if (!space) return { space: null, cwd: null, on: null };
  const belongs = focused?.space === space.id;
  const pane = belongs && focused.pane && space.tabs?.some((tab) => tab.id === focused.tab)
    ? panes.find((p) => p.pane === focused.pane && p.tab === focused.tab) : null;
  const standalone = belongs && focused.pane === null;
  const on = standalone ? (focused.terminal?.includes("/") ? focused.terminal.split("/")[0] : null) : space.machine ?? null;
  return { space: space.id, cwd: pane?.cwd || (belongs && focused.cwd) || space.folder || null, on };
}
