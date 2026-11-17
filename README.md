# Personal AI agent toolkit

Personal extensions, skills, and configuration for [Oh My Pi](https://github.com/can1357/oh-my-pi), a [nono](https://nono.sh/docs) sandbox profile, and a Herdr layout.

## Layout

| Path | Contents |
| --- | --- |
| `omp/extensions/` | English reviewer extension. |
| `omp/skills/` | Code review, CloudEvents, engineering reflection, EventStorming, functional thinking, Git commits, and UI design skills. |
| `omp/commands/` | User-invoked engineering reflection commands. |
| `omp/agent/` | Specialist task agents, model/tool settings, skill routing, personality, LSP, and MCP configuration. |
| `nono/profiles/madpo.json` | Sandbox profile for Go, JavaScript, Rust, .NET, and browser tooling. |
| `herdr/` | Herdr T3 layout, mods, key bindings, and upstream license. |

## Oh My Pi

Requires **Oh My Pi 18.11.2+**. Extensions run as TypeScript without a build. Run commands from this repository's root.

The baseline above does not establish `/deep-review` compatibility. Its minimum compatible OMP version and runtime behavior remain unverified.

### Configuration and installation

Review provider/model choices, then load the settings for one session:

```sh
omp --config ./omp/agent/config.yml
```

For persistent settings, merge the desired values from `omp/agent/config.yml`, `lsp.json`, and `mcp.json` into their counterparts in your active agent directory. Do not overwrite existing configuration blindly.

Link the always-loaded skill routing and personality, install the skills, task agents, and commands, and register the extension:

```sh
agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.omp/agent}"
mkdir -p "$agent_dir/skills" "$agent_dir/agents" "$agent_dir/commands"
ln -s "$PWD/omp/agent/RULES.md" "$agent_dir/RULES.md"
ln -s "$PWD/omp/agent/PERSONALITY.md" "$agent_dir/PERSONALITY.md"
for skill in code-review cloudevents engineering-reflection event-storming functional-thinking git-commit ui-component-design; do
  ln -s "$PWD/omp/skills/$skill" "$agent_dir/skills/$skill"
done
for agent in "$PWD"/omp/agent/agents/*.md; do
  ln -s "$agent" "$agent_dir/agents/"
done
for command in "$PWD"/omp/commands/*.md; do
  ln -s "$command" "$agent_dir/commands/"
done
omp plugin link .
```

These links do not overwrite existing files. Merge existing rules, personality instructions, or agent definitions as needed. For named profiles or XDG layouts, set `agent_dir` to the active agent directory. Root plugin linking does **not** discover the nested skills, agents, or commands, so keep the explicit links.

Oh My Pi discovers the linked Markdown files as native user commands from the active agent directory's `commands/` folder. Use `/task-start`, `/daily-review`, `/weekly-review`, or `/experiment`. Restart the session after installation. The commands load their skill and templates independently of the working directory. Command names may collide with existing user, project, extension, or plugin commands; inspect and resolve collisions before use. Existing command files are not overwritten.

### Deep review

`/deep-review` reviews local Git changes through specialist task agents. Git must be available on `PATH`.
The command runs Git through OMP's injected `api.exec`, using argument arrays.
Repository discovery starts from the active session's working directory. It never falls back to this toolkit's repository.

Install a self-contained copy, including in devcontainers:

1. Set `agent_dir` to the active agent directory, as shown above.
2. Inspect `$agent_dir/commands/deep-review` first. Reconcile any existing installation before copying.
3. Copy the entire command directory from this repository's root:

   ```sh
   mkdir -p "$agent_dir/commands"
   cp -R omp/agent/commands/deep-review "$agent_dir/commands/"
   ```

4. Install the `deep-reviewer` and `deep-review-*` task agents too. The task-agent installation loop above includes those definitions.
5. Restart the OMP session.

Copy-only installation requires no dependency installation, build, npm publication, or native runtime package.
The command imports only Node builtins and relative runtime modules. OMP imports are type-only.
Keep copied task-agent definitions available inside the devcontainer too; host-only symlinks cannot provide inaccessible files.
Alternatively, symlink the command directory using the existing convention when the source remains accessible.
Root plugin linking alone does not install this command or its task agents.

| Usage | Behavior |
| --- | --- |
| `/deep-review pr <base-ref> [review focus]` | Review committed changes against a base reference. |
| `/deep-review uncommitted [review focus]` | Review staged, unstaged, and untracked changes. |
| `/deep-review commit <commit-ref> [review focus]` | Review a specific commit without checking it out. |
| `/deep-review mode` | Show the repository's persistent review mode. |
| `/deep-review mode auto` | Use classification and adaptive specialist coverage; this is the default. |
| `/deep-review mode quick` | Use one reduced-depth reviewer, plus security review when explicitly requested. |
| `/deep-review mode full` | Run all seven specialists, including security. |

Mode selection persists in `.omp/deep-review-settings.json` within the reviewed repository.
In `auto`, security runs only when explicitly requested.

### Private engineering reflection

Configure the private `obsidian-vault` MCP connection described below for your chosen Obsidian vault. Keep authentication credentials outside this repository. The commands use the available MCP tool schemas and vault-relative paths; MCP need not expose a filesystem path.

If MCP is unavailable, provide an explicitly chosen, already existing private vault and authorize access. The commands ask when the vault or access is unavailable. They never assume a local vault path or create a second vault.

The commands preview proposed notes and request approval before writing by default. Cross-file, significant, ambiguous, or destructive changes require approval even when routine automatic saves are enabled. Journal data stays in the chosen private vault, not this repository. Installation does not touch a real vault, and no reflection runs on a schedule.

Start a new session after installation. Keep rules and skills enabled. The [routing policy](omp/agent/RULES.md) stays loaded: the main agent owns investigation, architecture, contracts, and acceptance; implementation subagents implement all code changes, including trivial fixes. It also defines role precedence, worker ownership, and verification handoffs; full skills load on demand. The custom personality replaces the selected preset unless `personality` is `none`; task subagents do not inherit it. `--config` alone installs neither file.

### Task agents

`omp/agent/agents/` contains 40 Oh My Pi task-agent definitions. User-level agents load from the active agent directory's `agents/` folder; project-local overrides belong in `.omp/agents/`. The repository's nested directory is not discovered automatically, and `--config` alone does not install agents.

Each definition declares its name, routing description, native tool allowlist, and configured `@model` role. Merge the relevant `modelRoles` from `omp/agent/config.yml`, or load that config when launching. `spawns` grants child-agent delegation only where needed. These prompts and tool allowlists are not an operating-system sandbox; keep process and filesystem permissions appropriate.

Use the `code-review` skill for the canonical review workflow: `reviewer` by default; security/API/performance specialists only when triggered; `verifier` for requested executable verification; and `review-integrator` only when multiple lanes ran. Explicit requests for standalone `code-reviewer`, `quality-reviewer`, or `style-reviewer` use their alternative, role-specific reports—not additional canonical lanes.

`reviewer` and `review-integrator` share structured output schemas with three independent assessments: `overall_correctness` (`correct`, `incorrect`, `not_verified`), `review_verdict` (`APPROVE`, `COMMENT`, `REQUEST_CHANGES`, `BLOCKED`), and `verification_status` (`complete`, `partial`, `not_verified`). Evidence completeness describes assigned checks, not an assertion that runtime tests ran. Consumers must handle all three fields and each gap's required `blocking` flag. P0–P3 finding priorities reflect impact; confidence is separate. A minor style finding does not establish incorrect behavior, and a verifier failure becomes a patch finding only with causal evidence and a patch anchor. Unavailable required proof blocks disposition rather than inventing a defect.

Under the coordinator policy, settle architectural decisions in the main agent before dispatch. Use `coder` for fixed-contract implementation and `team-executor` for independent owned concurrent lanes; implementation specialists such as `designer`, `build-fixer`, and `test-engineer` retain their expertise but implement under the same fixed boundaries. The routing policy does not prescribe models or require per-task model overrides; model selection remains in agent definitions and runtime configuration. Unavailable required agents are blockers rather than permission for inline coding. These rules do not create an operating-system/tool sandbox.

The main agent's handoff specifies decisions and rationale, allowed files and responsibilities, call chains/data flow, declaration-only signatures, behavioral contracts, acceptance criteria, and verification ownership—but no method bodies, implementation patches, or algorithmic pseudocode. Workers implement local details and return contract conflicts for a parent decision; the parent sends repairs back to workers rather than writing code itself. Requested policy/planning documentation can still be edited directly.

Team ownership changes require explicit main-agent authorization before edits, even when correctness requires an adjacent change. The main agent decides shared-interface changes and assigns implementation edits to a worker. Workers and coordinators report implementation (`implemented`, `partial`, `blocked`) separately from verification (`verified`, `deferred`, `unverified`, `failed`); deferred checks never imply verified completion.

Product and UX roles cite original evidence regardless of its delivering agent. Expert observations, predicted navigation paths, participant observations, and population-level inferences remain distinct; predicted paths are not observed user success rates. Other specialists return role-specific reports to their parent. Planning agents surface unresolved user decisions to the parent instead of starting independent interviews. Team agents use native `task` delegation and `agent://` coordination rather than an external team runtime.

### English reviewer

A separate, tool-free model reviews your English alongside the coding task and displays feedback after the response. It provides a correction, up to three explanations in Russian, and a natural developer-style version. Correct English gets “Looks good.”; submissions without meaningful English prose get no panel.

| Command | Behavior |
| --- | --- |
| `/english` or `/english status` | Show mode and model. |
| `/english async` or `/english on` | Review in parallel (default). |
| `/english off` | Disable review and discard pending feedback. |
| `/english strict` | Display feedback before coding; the original request still proceeds unchanged. |
| `/english model <selector>` | Select a configured model or role alias. |

The default model is **`@smol`**, using your configured provider credentials. Each reviewed submission costs an extra model request; provider failures warn without blocking coding. Changes last for the running extension instance, not in configuration files.

Try the extension without installing it, optionally overriding startup settings:

```sh
omp --no-extensions --extension ./omp/extensions/english-reviewer/index.ts \
  --english-mode async --english-model @smol
```

**Privacy and delivery:** ordinary input is captured before template/skill expansion. Only its text goes to the reviewer, including embedded code/logs—not images, files, history, or coding responses. Initial positional prompts use OMP's prepared text instead. Feedback never changes your request or enters the coding model's context. Commands and subagent prompts are skipped; headless print/JSON sessions skip review. Mode/model/session changes discard pending work; requests have a 60-second cancellation deadline.

### Development

Requires Bun. Checks need no provider credentials or paid model calls.

```sh
bun install
bun run typecheck
bun test
```

## nono

The profile extends **`nolabs-ai/omp`**. Install that parent pack, runtime CLIs, language servers, and Google Chrome separately. From an ordinary host shell, install the pack and create cache/configuration roots before launching. nono skips grants for missing paths:

```sh
nono pull nolabs-ai/omp
mkdir -p "$HOME/.bun" "$HOME/.npm" "$HOME/go" \
  "$HOME/.cargo" "$HOME/.rustup" \
  "$HOME/.dotnet" "$HOME/.nuget" "$HOME/.templateengine" \
  "${XDG_CACHE_HOME:-$HOME/.cache}" \
  "${XDG_CONFIG_HOME:-$HOME/.config}/git" \
  "${XDG_DATA_HOME:-$HOME/.local/share}/NuGet"
export PATH="$HOME/.cargo/bin:$HOME/.bun/bin:$HOME/go/bin:$HOME/.dotnet/tools:$HOME/.local/bin:$PATH"
nono profile validate ./nono/profiles/madpo.json
nono run --profile ./nono/profiles/madpo.json -- omp
```

Initialize your Node version manager first if needed; the sandbox inherits `PATH`. Review the profile's broad filesystem grants, deployment-specific `/base` and `/ralplan` paths, and any custom tool/cache locations. Git identity access does not imply credential access.

For Rust, install rustup, a Rust toolchain, and a native linker (for example, the Linux `build-essential` package) on the host first. Add the `rust-analyzer`, `rustfmt`, and `clippy` rustup components for language-server, formatting, and lint support. The profile grants write access to the default `$HOME/.cargo` and `$HOME/.rustup` directories for registry/git caches, Cargo locks, installed tools, and toolchain updates; project builds and executables stay under `$WORKDIR`. System headers are readable for crates that build native dependencies; install any required native development packages on the host. If you override `CARGO_HOME`, `RUSTUP_HOME`, or `CARGO_TARGET_DIR` outside the granted paths, add those locations with `--allow <directory>` before launching. From your Rust project directory, use `nono run --profile /absolute/path/to/harness/nono/profiles/omp.json -- cargo run` (or `cargo check`, `cargo test`, `cargo fmt`, or `cargo clippy`).

The `developer` network policy covers common registries, Git hosts, documentation, and AI providers, with additions for Go, NuGet, Bun, Rust/crates.io (including the sparse index, crate downloads, and rustup distribution servers), and Penpot. Local server ports are **3000, 5000, 5001, 5173, 8000, 8080, and 8765**; add others with `--open-port <port>`. Enumerated `192.168.1.*` addresses affect proxy routing, not TCP permissions.

For MCP, merge `omp/agent/mcp.json` into your active configuration. Set `PENPOT_TOKEN` outside the repository and connect the Penpot MCP plugin in the design file. Playwright runs headless Chrome with `--no-sandbox` (disabling Chrome's sandbox, not nono's). Remote browsing through nono's proxy requires explicit Playwright `browser.launchOptions.proxy` settings with the current server and separate username/password; Chrome does not automatically use `HTTPS_PROXY`. Keep destination domains allowed rather than weakening network isolation.

For Obsidian, install and enable the [Vault as MCP plugin](https://github.com/ebullient/obsidian-vault-mcp), then start its server. The default endpoint is `http://localhost:8765/mcp`. If plugin authentication is enabled, configure a Bearer `Authorization` header outside the repository. Ensure `localhost` reaches Obsidian; WSL networking may require a reachable host address instead.

## Herdr

`herdr/` contains [Herdr T3](https://github.com/JinJieBeWater/herdr-t3) at commit [`9a9fd18c88d3312577382944b42593c7d27e98fb`](https://github.com/JinJieBeWater/herdr-t3/tree/9a9fd18c88d3312577382944b42593c7d27e98fb). It also includes [Git Graph](https://github.com/rabeeh-ta/herdr-git-graph) at commit [`0da886243b2e27a6068d6adb7c5c26f349cdc04e`](https://github.com/rabeeh-ta/herdr-git-graph/tree/0da886243b2e27a6068d6adb7c5c26f349cdc04e). The Changes page uses this repository's native `t3-changes` mod. The layout and mods require Herdr App. T3 does not specify a minimum Herdr version. Git Graph reports testing on macOS with Herdr 0.1.9–0.1.12; Linux and Windows are untested. Optional T3 extras, including Review and themes, are not included.

Changes requires only Herdr App and Git on the focused repository's machine. It uses native GPUI controls, not a webview or helper service. No Rust, Python, GitHub CLI, separate installer, or authentication is required. The layout also references Herdr's built-in `workspace-status`; its runtime availability has not been verified. The Changes tab icon uses Herdr's built-in `changes` asset, not its mod. Native Changes rendering has not been verified in Herdr App locally.

Compatibility: Changes requires native `gpui-base` `Checkbox`, `Textarea`, `TextareaState`, `Scrollbar`, and `VirtualListScrollHandle` APIs. The [upstream contract](https://github.com/herdrdev/herdr-app/blob/8e1208deeff2a24441a192974e648c6fa0c5053c/vendor/gpui-kit/crates/shell/src/typings.rs) documents these controls. The commit editor starts with five rows and uses native multiline events. The editor retains its built-in accessibility role.

Install from this repository's root:

1. Back up `~/.config/herdr-app/`, including existing `layouts/`, `mods/`, and `keys.json`.
2. Create `~/.config/herdr-app/layouts/` and `~/.config/herdr-app/mods/` if needed. Inspect destinations before copying; reconcile existing customizations rather than overwriting them blindly.
3. Copy `herdr/layouts/herdr-t3.json` and `herdr/layouts/herdr-t3.svg` into the app's `layouts/` directory, or merge the Changes block into a customized layout. Preserve its `changes` block ID and set its content mod to `t3-changes`. Replacing a layout can discard its theme, focus ring, sidebar state, or added blocks.
4. Copy each directory in `herdr/mods/t3-*` and `herdr/mods/git-graph` into the app's `mods/` directory. Include `t3-changes`, `t3-files`, `git-graph`, and `t3-chrome`. Copy every file in `t3-changes`, including `tree-row.js`, `file-icons.js`, and `file-icons-data.js`. Changes uses its local tree renderer and icon resolver. The installed T3 Files mod supplies icon assets; Git Graph supplies the refresh icon. Changes does not import JavaScript from sibling mods. Reconcile any existing mod customizations first. Use real copies, not symlinks: upstream says mod SVGs do not load through symlinks.
5. Merge `herdr/keys.json` into `~/.config/herdr-app/keys.json`. If no file exists, copy it there. Otherwise, merge each section and key, retaining unrelated sections and bindings. Choose explicitly between conflicting bindings. The file includes the original global and terminal bindings alongside T3 layout and mod bindings. Layout-scoped shortcuts may override global shortcuts.
6. Select `herdr-t3` in Herdr's layout picker. See the [T3 guide](https://github.com/JinJieBeWater/herdr-t3/blob/9a9fd18c88d3312577382944b42593c7d27e98fb/docs/user/guide.md) for usage and key commands.

For a customized layout, also merge the `branches` block and update `t3-chrome` to expose its tab.
Copy the complete `t3-branches/` directory, including its icons and local modules.

The T3 bindings target macOS. On Linux and Windows, Herdr defaults can bypass layout rules, including close confirmation and Home-aware space numbering. Rebind those keys manually as described in the [upstream key guide](https://github.com/JinJieBeWater/herdr-t3/blob/9a9fd18c88d3312577382944b42593c7d27e98fb/docs/user/guide.md#keys).

Open the right-side panel with its existing button or binding, then select **Git** beside **Files**. The panel button reopens the last selected page. Git Graph follows the focused terminal's repository and offers commit details, diffs, and Git actions. In a folder containing repositories, its Manygit view lists them. See the [Git Graph guide](https://github.com/rabeeh-ta/herdr-git-graph/tree/0da886243b2e27a6068d6adb7c5c26f349cdc04e#what-it-does) for its actions and limits. Manygit requires `find` and `env` and does not work on Windows.

Files follows the focused terminal's live directory, falling back to the space's configured folder when needed. It keeps browsing state per space and invalidates cached content when that space's directory or machine changes. Space switches reject pending reads from the previous context.

After updating, recopy both `t3-files/` and `t3-changes/`, including each mod's local `context.js` module.

Select **Branches** in the right-side panel to browse the focused repository's branch tree.
**Pinned**, **Local**, and **Remote** folders separate favorites, local branches, and remote-tracking branches.
Slashes create nested folders: `backup/123` and `backup/234` share the `backup` folder.
Remote branches also group beneath their remote name, such as `origin`.

Use **Pin** or **Unpin** beside a branch, or in its context menu, to update **Pinned**.
Pins persist per machine and repository, keeping local and remote refs distinct.
Pinning does not remove a branch from its original folder.
Selecting a branch does not check it out or change the repository.

Right-click a branch, including a **Pinned** copy, to open its actions.
Folders have no branch actions.
Available actions include **Checkout**, **Merge into current**, **Rebase current onto selected**, and **Interactive rebase current onto selected**.
The menu also offers **New branch**, **New tag**, **Delete**, **Copy branch name**, and **Pin** or **Unpin**.
Actions that don't apply to the current branch or detached HEAD are omitted.
Local checkout runs directly; other mutations require a dialog.
Remote checkout creates a tracking branch with an unused local name.
New tags support an optional annotation message.
Local deletion defaults to protecting unmerged commits; force deletion requires an explicit checkbox.
Remote deletion confirms a shared server change and accesses the network.

Interactive rebase provides a native editable todo with pick, drop, reorder, squash, and fixup.
Only captured eligible commits are accepted; exec, edit, reword, and shell commands are forbidden.
Branch actions reject changed focus, repository, HEAD, or selected branch tips.
Git failures remain visible, and conflicts remain available for resolution outside Branches.
Branches never automatically abort, reset, or force a conflicting operation.
Interactive rebase requires Git, POSIX `sh`, and `env` on the repository machine.
After attempted mutations, Branches refreshes the original repository view and notifies Git Graph.
Use **Refresh** to reread branches after external Git changes.
Refresh does not fetch from remotes or access the network.

In the branch tree, use Up and Down to navigate, and Left and Right to collapse or expand folders.
Enter selects a branch or toggles a folder; Space pins or unpins the focused branch.
Shift+F10 or the context-menu key opens actions for the focused branch.
In the menu, arrows navigate, Enter activates an action, and Escape closes the menu.
Tab reaches dialog inputs and buttons; Escape cancels before execution.
Long names remain accessible through horizontal scrolling.
Install updates by copying `t3-branches/`, updating `t3-chrome/`, and merging the layout's `branches` block.
Preserve the `branches` block ID and its `t3-branches` content mod.
Native Branches rendering, contrast across themes, and platform keyboard behavior still require verification in Herdr App.
Mock-native control harnesses exercise handlers, not pixels or real-app layout.

Select **Changes** in the right-side panel to prepare a commit in the focused terminal's repository. All changed files appear once in a directory tree. Check files individually, check a folder's descendants, or select all files. Selecting a row previews its diff in wide panels. Git Graph's **Open Changes** and **Show in Changes panel** actions still select this page.

Use **Refresh** to reload external edits. Use **Stash selected** to stash checked files, including checked untracked files. Use **Rollback selected** to discard checked changes after confirmation. Rollback restores tracked files to HEAD and removes selected new files. Unchecked files remain untouched. Resolve conflicts outside Changes before using these actions.

Enter a multiline **Commit message** in the large bottom editor. **Commit** records the checked files' complete working-tree versions, including both staged and unstaged changes. Unchecked staged files stay outside the commit. New files may acquire intent-to-add entries before Git runs commit hooks. A failed commit can leave those entries behind. The message reaches Git unchanged through one `--cleanup=verbatim -m` argument. Whitespace, blank lines, and comments remain intact.

**Commit and push** commits first, then runs a normal push. If push fails, the local commit remains successful. Fix the remote or tracking configuration, then push through Git Graph or your terminal. Do not commit again merely to retry the push. Changes never force-pushes, including after amend.

Check **Amend** to load HEAD's changed files, already checked, and its commit message. **Commit** then rewrites HEAD instead of adding a commit. Existing HEAD contents remain the amendment's baseline. Unchecking a previous-only file does not remove that file's changes from HEAD. Checkboxes choose additional working-tree changes; amend also supports message-only changes. Unchecking **Amend** restores the normal commit draft and removes previous-only files from the list. Amend requires an existing commit.

Changes keeps T3 Files' compact rows, file-type icons, expandable folders, and status badges. The tree supports horizontal and vertical scrolling. Long filenames remain readable through horizontal scrolling rather than permanent truncation. Wide panels retain the diff preview beside the tree. Narrow panels prioritize the tree and keep the commit editor below it.

Changes refreshes when opened, after mutations, and when the focused space or repository changes. Switching spaces reloads even when both spaces use the same machine and directory. Drafts remain scoped to machine and repository. Refresh preserves same-context file selections and selects newly discovered files. Changes does not poll Git or refresh from Git Graph notifications. Progress and errors remain visible. The bottom editor supports multiline text and internal scrolling.

Keyboard users can Tab through controls and the native message field. Enter and Shift+Enter insert newlines; only explicit button activation submits a commit. In the tree, arrow keys navigate, Enter previews or expands, and Space toggles inclusion. Left and Right collapse and expand folders. Failed commits retain the draft. Successful local commits clear only an unchanged draft, preserving text entered while Git hooks run.

**Permissions and effects:** Review the imported mod code before using it. T3 mods run Git, shell, and `hc` commands; they inspect local or remote space files and repositories. They write agent labels and caches, and Actions runs user-defined shell commands. Machine Connect can remove and add an `hc` machine; file actions can open local files or use the clipboard. On macOS, zoom changes can rewrite the installed layout. T3 upstream reports no network requests by the layout itself. See upstream [What it runs](https://github.com/JinJieBeWater/herdr-t3/blob/9a9fd18c88d3312577382944b42593c7d27e98fb/README.md#what-it-runs) for details.

Git Graph runs Git on the focused repository's machine and reads untracked files for diffs. Manygit scans folders and periodically checks listed repositories; Git status can run repository-configured clean filters. Fetch, pull, push, and remote branch deletion can access the network. Git actions can change repositories, including destructive resets; review each action's confirmation. Local branch checkout and Fetch run without confirmation.

Changes runs Git through argument arrays on the focused repository's machine, including remote machines. Status and diff reads disable optional index locks, external diff drivers, and textconv. Untracked previews use Git's no-index diff. Symbolic links show their targets, not the targets' contents. Git may run configured clean filters, commit hooks, and signing programs. Commit changes local history; amend rewrites HEAD. Stash changes the working tree and index. Confirmed rollback discards selected changes. Push can access the network and requires the repository's existing authentication.

Changes checks HEAD and branch before mutations and rejects actions after focus changes. External Git operations can still race after preflight. Finish concurrent Git work before mutating the same checkout. HEAD changes invalidate amend data. Git failures retain the draft unless the local commit already succeeded before a push failure. Changes publishes mutation notifications so Git Graph can refresh. Reconcile and recopy `herdr/mods/t3-changes/` to install updates; no separate build step is required.

Git Graph also checks GitHub's public releases API at most once a day without a token or repository details. The request still reaches GitHub. The mod does not update itself. Choose **Stop checking** in its update window to disable future checks, or set `CHECK = false` in the installed `git-graph/update.js` before use. Replacing the mod can restore that code setting. See upstream [What it runs](https://github.com/rabeeh-ta/herdr-git-graph/blob/0da886243b2e27a6068d6adb7c5c26f349cdc04e/README.md#what-it-runs) and [Updating](https://github.com/rabeeh-ta/herdr-git-graph/blob/0da886243b2e27a6068d6adb7c5c26f349cdc04e/README.md#updating).

Herdr T3 is Apache-2.0; see [`herdr/LICENSE`](herdr/LICENSE). Git Graph is MIT; see [`herdr/mods/git-graph/LICENSE`](herdr/mods/git-graph/LICENSE). Its copied graph icon is also used in T3 chrome; see Git Graph's [Lucide notice](herdr/mods/git-graph/icons/LICENSE-lucide.txt). The imported mod notices and bundled licenses retain third-party attribution. T3 upstream credits Herdr App, Lucide, Catppuccin icons, and uFuzzy; see its [credits](https://github.com/JinJieBeWater/herdr-t3/blob/9a9fd18c88d3312577382944b42593c7d27e98fb/README.md#credits-and-license).

## Conventions

Group reusable content by tool, use descriptive kebab-case names, and document dependencies and permissions. Keep credentials, transcripts, and machine-specific configuration out of the repository. The npm package is private to prevent accidental publication.

See the [Oh My Pi documentation](https://github.com/can1357/oh-my-pi/tree/main/docs) and [extension authoring guide](https://github.com/can1357/oh-my-pi/blob/main/docs/skills/authoring-extensions.md).
