# Review Assistant for Herdr Desktop

Review Assistant adds a tab to the T3 right panel. It groups Git changes by purpose and suggests what to verify in changed and related unchanged code. It is separate from the optional upstream T3 Review mod.

## Install and open

1. Install and launch [official Herdr Desktop](https://github.com/herdrdev/herdr-app#install). The `herdr` terminal app and the `hc` CLI are not substitutes for `herdr-app`.
2. Install Git 2.45 or later on the workspace machine. For a Herdr SSH workspace, install Git on the remote machine.
3. Follow the [T3 installation steps](../README.md#herdr) for the layout, mods, and optional key bindings. Use `~/.config/herdr-app/` or the directory set by `HERDR_APP_HOME`.
4. If you customized T3, merge the `review-assistant` block into your `panel-body` stack. Update `t3-chrome` and install the `review-assistant` mod.
5. Install [Bun](https://bun.sh/) on the desktop machine. Put `bun` and either `hc` or `herdr-core` on Herdr Desktop's `PATH`, then restart Herdr.
6. Connect the Linux workspace machine in Herdr. Install and configure OMP and the intended sandbox wrapper on that machine.
7. Select `herdr-t3` in Herdr's layout picker. Focus a terminal in the worktree you want to review.
8. Click **Show panel** near the right end of the T3 tab bar. Select **Review Assistant** next to **Branches**.

## Compare branches

1. Open **Select branch** and choose a local or remote-tracking branch. Use **Search branches** to filter by name.
2. Open **Actions** to the left of **Select branch** and choose a review action. Check its machine, working directory, and exact arguments under **Review launcher**.
3. Select **Compare** to run the selected action with review evidence on stdin.
4. Select **Compare** again whenever you want a new comparison, even if you have not changed the selection.

You can select any action saved in T3. For a review result, choose an action that starts OMP and returns its JSON output.

Review Assistant compares the checked-out branch with the branches' merge base. The review includes committed additions, deletions, and detected renames. It excludes staged, unstaged, and untracked changes. Influence also skips paths with local changes.

The dropdown lists refs already on the workspace machine. Review Assistant never fetches; update remote-tracking refs separately if needed.

To preselect a target, add `targetBranch` under `content.props` in your layout's `review-assistant` block:

```json
{
  "id": "review-assistant",
  "type": "block",
  "content": {
    "mod": "review-assistant",
    "props": { "targetBranch": "origin/main" }
  }
}
```

Use a fully qualified ref to distinguish identical branch names. For short names, local branches take precedence. Preselecting a branch does not start a comparison.

## Set up a review launcher in Actions

1. Open **Actions** in the T3 toolbar. Reuse an action that starts OMP, or select **Add action**.
2. Enter a name and command, such as `omp` or `nono run --profile development -- omp`. Use a sandbox wrapper if you want sandboxing.
3. Choose the action from **Actions** in Review Assistant. Review Assistant remembers the exact selection for the current machine and working directory.
4. Select the action again if you rename it or change its command. Review Assistant never substitutes another action.

Review Assistant appends its worker flags to commands with literal arguments. Quote paths with spaces. No special action name is required.

For commands that use shell syntax, Review Assistant runs the action with `sh -c`. The worker flags are available as positional arguments. Forward `"$@"` to OMP and leave stdin available, as in `exec "$HOME/.local/bin/omp" "$@"`.

The selected action runs headless through Herdr Core in the review worktree. The action's optional folder doesn't apply. Review Assistant doesn't prompt the focused agent or open a terminal.

Review Assistant no longer uses `programs.json` to discover launchers. Move any existing review launcher commands into T3 Actions.

### Data and consent

- **Consent:** Compare sends review evidence to the selected action. Choose a command you trust with that data. Choosing an action alone doesn't send evidence.
- **Data sent:** Review Assistant sends text diffs, changed paths, and bounded excerpts of related unchanged code. The prompt limit is 96 KiB, and the review response limit is 256 KiB. The panel omits binary patch payloads.
- **Desktop transport:** The bridge stages evidence briefly in the desktop app home. Keep that directory private, including any `HERDR_APP_HOME` override. On Windows, use a directory inside your private user profile. The bridge removes the staged evidence during normal operation.
- **Worker access:** The worker flags disable OMP tools, extensions, and session persistence. Your action must forward those flags. Operating-system sandboxing depends on the command you choose.
- **Provider retention:** Diffs can contain secrets. Check what the configured OMP provider logs or retains before comparing.

## Read and rerun a review

1. If analysis fails, address the message and select **Compare** again. A comparison with no changes does not start OMP.
2. Read **Logical Changes** by purpose. Treat importance as suggested review priority. Use **Key to review** to decide what to check against the code.
3. Expand **Changed files (N)** and select a file to open its read-only diff inside the panel. Changed file lists start collapsed in normal use.
4. Read **Influence** for possible effects on unchanged code. Select a source reference to open a read-only excerpt around that line. Use **Close preview** to dismiss either preview. Use Git in the workspace terminal if you need a complete diff or source file.
5. Select **Compare** again after the branches change. If the panel says the review is out of date, treat the suggestions as historical. Preview navigation stays disabled until the review is current again.

Review Assistant checks Git periodically while its tab is visible. Each **Compare** press reads Git again. If the comparison has changes, the panel starts a fresh worker. It preserves matching expanded groups where possible. Closing the mod or quitting Herdr clears its in-memory review results.

AI suggestions can miss risks or misunderstand code. Influence references point to unchanged code, but the suggested effects are not confirmed. An empty Influence list does not establish that nothing else is affected. Verify the important claims yourself before accepting changes.

## Run checks and capture the demo

Run the Review Assistant suite from the repository root with Bun and Git 2.45 or later. The suite needs no provider credentials or native Herdr Desktop.

```sh
bun test tests/herdr-review-*.test.js
```

Run the desktop host's initial mod validation against the installed copy:

```sh
app_home="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
herdr-app check "$app_home/mods/review-assistant"
```

The native check does not replace opening the layout and exercising the panel. On Windows, use the desktop app home in place of the shell example.

1. Copy the installed `herdr-t3.json` to `herdr-t3-review-assistant-demo.json` in `layouts/`. Keep the regular layout unchanged.
2. Set `"props": { "demo": true }` under `content` in the temporary layout's `review-assistant` block. If the block already has `props`, add `"demo": true` inside that object.
3. Select the temporary layout and open **Review Assistant**. Demo mode shows a sample launcher and review. It does not read Git or start OMP.
4. Inspect the displayed panel and capture the actual app window from the repository root. Use the same `HERDR_APP_HOME` as the running window if you use a custom app home.

   ```sh
   herdr-app shot herdr/review-assistant.png
   ```

5. Switch back to `herdr-t3` and remove the temporary demo layout. Keep `demo` off the regular layout so it reviews real changes.

## Disable or uninstall

1. Select **Clear launcher** to stop future analysis in the current workspace. Delete the action in T3 Actions to remove it everywhere. Neither action retracts evidence already sent.
2. To remove the tab, remove the `review-assistant` block from your installed T3 layout. You can then remove the installed `review-assistant` mod.
