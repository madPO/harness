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
2. Select a **Review launcher**. Check its name, machine, working directory, and exact argument list.
3. Select **Compare** to send the review evidence through the selected launcher's OMP provider.
4. Select **Compare** again whenever you want a new comparison, even if you have not changed the selection.

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

## Register a review launcher

The mod no longer reads `review-assistant.json`. If you used that file, remove it from your app home.

Merge an entry into the `programs` object in Herdr Desktop's existing `programs.json`. Use the desktop app home, including on Windows.
Use a distinct `review-omp-` key for each sandbox or launch command. For example:

```json
{
  "programs": {
    "review-omp-development": {
      "name": "OMP · development sandbox",
      "run": [
        "/home/you/.local/bin/nono",
        "run",
        "--profile",
        "development",
        "--",
        "/home/you/.local/bin/omp"
      ]
    }
  }
}
```

1. Replace the paths and wrapper arguments with the actual Linux launch command. Use an absolute wrapper path.
2. Use a wrapper that forwards appended options and stdin to a fresh OMP invocation. Do not add prompt text, credentials, session-resume flags, `--tools`, `--extension`, `-e`, or `--hook`.
3. Select the launcher in the panel. Review Assistant stores the exact selection for the machine and working directory in Herdr's shared state.
4. Select the launcher again if the command changes or disappears. Review Assistant never substitutes another launcher.

The panel starts a fresh, headless OMP worker through Herdr Core on the selected workspace machine. It uses OMP’s existing provider credentials and model settings. It does not prompt the focused agent.

### Data and consent

- **Consent:** Selecting **Compare** authorizes the selected OMP provider to receive review evidence. Opening the panel and choosing a launcher do not send evidence.
- **Data sent:** Review Assistant sends text diffs, changed paths, and bounded excerpts of related unchanged code. The prompt limit is 96 KiB, and the review response limit is 256 KiB. The panel omits binary patch payloads.
- **Desktop transport:** The bridge stages evidence briefly in the desktop app home. Keep that directory private, including any `HERDR_APP_HOME` override. On Windows, use a directory inside your private user profile. The bridge removes the staged evidence during normal operation.
- **Worker access:** Review Assistant passes flags to disable tools, extensions, and session persistence. Use trusted wrappers that forward those flags. The remote sandbox still governs operating-system access.
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

1. Select **Clear launcher** to stop future analysis in the current workspace. Remove the launcher's program entry to make it unavailable everywhere. Neither action retracts evidence already sent.
2. To remove the tab, remove the `review-assistant` block from your installed T3 layout. You can then remove the installed `review-assistant` mod.
