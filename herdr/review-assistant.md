# Review Assistant for Herdr Desktop

Review Assistant adds a tab to the T3 right panel. It groups Git changes by purpose and suggests what to verify in changed and related unchanged code. It is separate from the optional upstream T3 Review mod.

## Install and open

1. Install and launch [official Herdr Desktop](https://github.com/herdrdev/herdr-app#install). The `herdr` terminal app and the `hc` CLI are not substitutes for `herdr-app`.
2. Install Git 2.45 or later on the workspace machine. For a Herdr SSH workspace, install Git on the remote machine.
3. Follow the [T3 installation steps](../README.md#herdr) for the layout, mods, and optional key bindings. Use `~/.config/herdr-app/` or the directory set by `HERDR_APP_HOME`.
4. If you customized T3, merge the `review-assistant` block into your `panel-body` stack. Update `t3-chrome` and install the `review-assistant` mod.
5. Select `herdr-t3` in Herdr's layout picker. Focus a terminal in the worktree you want to review.
6. Click **Show panel** near the right end of the T3 tab bar. Select **Review Assistant** next to **Branches**.

## Compare branches

1. Open **Select branch** and choose a local or remote-tracking branch.
2. Select **Compare** to review the current local branch against the selected branch. Check out a local branch first if HEAD is detached.
3. Select **Compare** again whenever you want a new comparison, even if you have not changed the selection.

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

## Configure analysis and consent

Create `~/.config/herdr-app/review-assistant.json` on the desktop machine. If you set `HERDR_APP_HOME`, create `review-assistant.json` there instead. Use only these fields:

```json
{
  "consent": true,
  "endpoint": "https://provider.example/v1/chat/completions",
  "model": "your-model-id",
  "apiKey": "your-bearer-token"
}
```

Use an OpenAI-compatible Chat Completions endpoint and a model that supports JSON mode. Omit `apiKey` if the endpoint does not require a bearer token. Use a full HTTPS URL without credentials, a query, or a fragment. Plain HTTP is allowed only for loopback addresses on the desktop machine. Restrict access to the file and keep the key and configuration out of the repository.

Set `"consent": true` only if you authorize sending repository content to that provider. Provider requests require valid configuration and a **Compare** press. Opening the tab, selecting a branch, and automatic Git checks do not contact the provider.

- **Data sent:** Herdr Desktop sends plain text diffs, changed paths, and bounded excerpts from related unchanged source. Git reads run on the selected workspace machine, including over SSH. The provider request still originates from the desktop.
- **Request limit:** The serialized JSON request body is limited to 96 KiB. Binary patch payloads are omitted. Oversized requests are rejected before sending; review a smaller scope or inspect the diff locally.
- **Trust boundaries:** Treat diffs and excerpts as sensitive. Review what your provider may log or retain before enabling analysis. Keeping the API key out of Git does not remove secrets already present in source or diffs. Herdr mods are trusted code, not sandboxed extensions.
- **Provider capabilities:** Review Assistant sends evidence, not tools or shell access. It validates returned file references against the evidence and does not execute model instructions. It does not edit the repository, approve changes, or submit review comments.

## Read and rerun a review

1. If analysis fails, address the message and select **Compare** again. A comparison with no changes does not need provider analysis.
2. Read **Logical Changes** by purpose. Treat importance as suggested review priority. Use **Key to review** to decide what to check against the code.
3. Expand **Changed files (N)** and select a file to open its read-only diff inside the panel. Changed file lists start collapsed in normal use.
4. Read **Influence** for possible effects on unchanged code. Select a source reference to open a read-only excerpt around that line. Use **Close preview** to dismiss either preview. Use Git in the workspace terminal if you need a complete diff or source file.
5. Select **Compare** again after the branches change. If the panel says the review is out of date, treat the suggestions as historical. Preview navigation stays disabled until the review is current again.

Review Assistant checks Git periodically while its tab is visible. Each **Compare** press reads Git again. If the comparison has changes, Review Assistant requests fresh analysis. Review Assistant preserves matching expanded groups where possible. Closing the mod or quitting Herdr clears its in-memory review state.

AI suggestions can miss risks or misunderstand code. Influence references point to unchanged code, but the suggested effects are not confirmed. An empty Influence list does not establish that nothing else is affected. Verify the important claims yourself before accepting changes.

## Run checks and capture the demo

Run the Review Assistant suite from the repository root with Bun and Git 2.45 or later. The suite does not require provider credentials or native Herdr Desktop.

```sh
bun test tests/herdr-review-*.test.js
```

Run the desktop host's initial mod validation against the installed copy:

```sh
app_home="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
herdr-app check "$app_home/mods/review-assistant"
```

The native check does not replace opening the layout and exercising the live panel. Native validation and a screenshot are not yet available for this change.

1. Copy the installed `herdr-t3.json` to `herdr-t3-review-assistant-demo.json` in `layouts/`. Keep the regular layout unchanged.
2. Set `"props": { "demo": true }` under `content` in the temporary layout's `review-assistant` block. If the block already has `props`, add `"demo": true` inside that object.
3. Select the temporary layout in the running desktop app. Open the right panel and select **Review Assistant**. The demo shows fixture data with only the first group's changed-file list expanded. It does not read Git or call a provider.
4. Inspect the displayed panel and capture the actual app window from the repository root. Use the same `HERDR_APP_HOME` as the running window if you use a custom app home.

   ```sh
   herdr-app shot herdr/review-assistant.png
   ```

5. Switch back to `herdr-t3` and remove the temporary demo layout. Keep `demo` off the regular layout so it reviews real changes.

## Disable or uninstall

1. Remove `review-assistant.json` from the desktop app home, or set `"consent": false`, to block future analysis requests. This does not retract data already sent to the provider.
2. To remove the tab, remove the `review-assistant` block from your installed T3 layout. You can then remove the installed `review-assistant` mod.
