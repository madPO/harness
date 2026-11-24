// Herdr qualifies remote IDs and terminal addresses with the machine name.
function machineOf(id) {
  const separator = id?.indexOf("/") ?? -1;
  return separator > 0 ? id.slice(0, separator) : null;
}

export function resolveContext(spaces, panes, focused) {
  const focusedSpace = spaces.find((space) => space.id === focused?.space);
  const space = focusedSpace ?? spaces.find((space) => space.active);
  if (!space) return { space: null, cwd: null, on: null };

  const on = space.machine ?? machineOf(space.id);
  const focusedTab = focusedSpace?.tabs?.find((tab) => tab.id === focused.tab);
  const tab = focusedTab ?? space.tabs?.find((tab) => tab.active);
  // A standalone layout terminal can be on a different machine than the selected space.
  const standaloneCwd = focusedTab && focused.pane === null && focused.terminal && machineOf(focused.terminal) === on
    ? focused.cwd : null;
  let tabCwd = null;
  let focusedCwd = null;
  if (tab && !standaloneCwd) {
    for (const pane of panes) {
      if (pane.tab !== tab.id || !pane.cwd || (pane.terminal && machineOf(pane.terminal) !== on)) continue;
      if (focusedTab && pane.pane === focused.pane) {
        focusedCwd = pane.cwd;
        break;
      }
      tabCwd ??= pane.cwd;
      if (pane.focused) focusedCwd = pane.cwd;
    }
  }
  return { space: space.id, cwd: standaloneCwd || focusedCwd || tabCwd || space.folder || null, on };
}
