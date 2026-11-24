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
| `herdr/` | Herdr T3 layouts, Review Assistant, Git mods, key bindings, and upstream license. |

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

Restart Oh My Pi after installation. The reflection commands are `/task-start`, `/daily-review`, `/weekly-review`, and `/experiment`. Resolve any command-name collisions before use.

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

The command needs no build or dependency installation. In a devcontainer, ensure both the copied command and task agents are accessible. Plugin linking alone does not install them.

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

Configure the private `obsidian-vault` MCP connection described below. Keep credentials outside this repository.

The commands preview notes and request approval before writing by default. They do not create a vault or run on a schedule. If MCP is unavailable, provide access to an existing private vault.

### Task agents

The definitions in `omp/agent/agents/` must be installed in the active agent directory. Load or merge the relevant `modelRoles` from `omp/agent/config.yml`. Agent prompts and tool allowlists do not replace an operating-system sandbox.

The [routing policy](omp/agent/RULES.md) describes agent selection, implementation handoffs, and review workflows. The [personality](omp/agent/PERSONALITY.md) applies to the main agent, not task subagents.

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

**Privacy:** The reviewer sends submission text, including embedded code and logs, to the configured model. It does not send images, files, history, or coding responses. Commands, subagent prompts, and headless sessions are skipped.

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

For Rust, install a toolchain, native linker, `rust-analyzer`, `rustfmt`, and `clippy` on the host. Add custom Cargo, Rustup, or build directories outside the profile's grants with `--allow`.

The `developer` network policy covers common registries, Git hosts, documentation, and AI providers, with additions for Go, NuGet, Bun, Rust/crates.io (including the sparse index, crate downloads, and rustup distribution servers), and Penpot. Local server ports are **3000, 5000, 5001, 5173, 8000, 8080, and 8765**; add others with `--open-port <port>`. Enumerated `192.168.1.*` addresses affect proxy routing, not TCP permissions.

For MCP, merge `omp/agent/mcp.json` into your active configuration. Set `PENPOT_TOKEN` outside the repository and connect the Penpot MCP plugin in the design file. Playwright runs headless Chrome with `--no-sandbox` (disabling Chrome's sandbox, not nono's). Remote browsing through nono's proxy requires explicit Playwright `browser.launchOptions.proxy` settings with the current server and separate username/password; Chrome does not automatically use `HTTPS_PROXY`. Keep destination domains allowed rather than weakening network isolation.

For Obsidian, install and enable the [Vault as MCP plugin](https://github.com/ebullient/obsidian-vault-mcp), then start its server. The default endpoint is `http://localhost:8765/mcp`. If plugin authentication is enabled, configure a Bearer `Authorization` header outside the repository. Ensure `localhost` reaches Obsidian; WSL networking may require a reachable host address instead.

## Herdr

`herdr/` contains [Herdr T3](https://github.com/JinJieBeWater/herdr-t3/tree/9a9fd18c88d3312577382944b42593c7d27e98fb), [Git Graph](https://github.com/rabeeh-ta/herdr-git-graph/tree/0da886243b2e27a6068d6adb7c5c26f349cdc04e), and local Changes and Branches mods. Herdr App and Git are required. Optional T3 themes and Review are not included.

Native Changes and Branches rendering has not been verified in Herdr App. Git Graph reports testing on macOS with Herdr 0.1.9–0.1.12; Linux and Windows are untested.

Install from this repository's root:

1. Back up `~/.config/herdr-app/`, including existing `layouts/`, `mods/`, and `keys.json`.
2. Create `~/.config/herdr-app/layouts/` and `~/.config/herdr-app/mods/` if needed. Inspect destinations before copying; reconcile existing customizations rather than overwriting them blindly.
3. Copy `herdr/layouts/herdr-t3.json` and `herdr/layouts/herdr-t3.svg` into the app's `layouts/` directory, or merge the Changes block into a customized layout. Preserve its `changes` block ID and set its content mod to `t3-changes`. Replacing a layout can discard its theme, focus ring, sidebar state, or added blocks.
4. Copy each directory in `herdr/mods/t3-*`, `herdr/mods/git-graph`, and `herdr/mods/review-assistant` into the app's `mods/` directory. Include `t3-changes`, `t3-files`, `git-graph`, and `t3-chrome`. Copy every file in `t3-changes`, including `tree-row.js`, `file-icons.js`, and `file-icons-data.js`. Changes uses its local tree renderer and icon resolver. The installed T3 Files mod supplies icon assets; Git Graph supplies the refresh icon. Changes does not import JavaScript from sibling mods. Reconcile any existing mod customizations first. Use real copies, not symlinks: upstream says mod SVGs do not load through symlinks.
5. Merge `herdr/keys.json` into `~/.config/herdr-app/keys.json`. If no file exists, copy it there. Otherwise, merge each section and key, retaining unrelated sections and bindings. Choose explicitly between conflicting bindings. The file includes the original global and terminal bindings alongside T3 layout and mod bindings. Layout-scoped shortcuts may override global shortcuts.
6. Select `herdr-t3` in Herdr's layout picker. See the [T3 guide](https://github.com/JinJieBeWater/herdr-t3/blob/9a9fd18c88d3312577382944b42593c7d27e98fb/docs/user/guide.md) for usage and key commands.

For a customized layout, merge the `branches` block and update `t3-chrome` to expose its tab. Preserve the block ID and `t3-branches` content mod.

The T3 bindings target macOS. On Linux and Windows, rebind keys as described in the [upstream key guide](https://github.com/JinJieBeWater/herdr-t3/blob/9a9fd18c88d3312577382944b42593c7d27e98fb/docs/user/guide.md#keys).

### Review Assistant

[Install and use Review Assistant](herdr/review-assistant.md) from the right panel in `herdr-t3`.
It groups Git changes by purpose and highlights related unchanged code for human review.
Review Assistant is separate from the optional upstream T3 Review mod.

### Git panels

- **Files** follows the focused terminal's directory.
- **Git** shows repository history, diffs, and Git actions. Its Manygit view needs `find` and `env` and does not work on Windows.
- **Branches** lists local and remote branches and supports pins, checkout, merge, rebase, tags, and deletion. Mutations other than local checkout require confirmation. Refresh does not fetch.
- **Changes** selects files for commits, stash, or rollback. Expand the panel for a read-only diff of the active file. Previews may be truncated; use a terminal for complete diffs.

Copy complete mod directories when updating. Changes depends on icon assets from T3 Files and Git Graph.

Use **Refresh** to reload external edits. Use **Stash selected** to stash checked files, including checked untracked files. Use **Rollback selected** to discard checked changes after confirmation. Rollback restores tracked files to HEAD and removes selected new files. Unchecked files remain untouched. Resolve conflicts outside Changes before using these actions.

Enter a multiline **Commit message** in the large bottom editor. **Commit** records the checked files' complete working-tree versions, including both staged and unstaged changes. Unchecked staged files stay outside the commit. New files may acquire intent-to-add entries before Git runs commit hooks. A failed commit can leave those entries behind. The message reaches Git unchanged through one `--cleanup=verbatim -m` argument. Whitespace, blank lines, and comments remain intact.

**Commit and push** commits first, then runs a normal push. If push fails, the local commit remains successful. Fix the remote or tracking configuration, then push through Git Graph or your terminal. Do not commit again merely to retry the push. Changes never force-pushes, including after amend.

**Amend** rewrites HEAD. Existing commit contents remain the baseline; checked files add working-tree changes. Message-only amendments are supported.

Files start unchecked. Refresh preserves selections for files still listed. Failed commits retain the draft. Changes does not poll Git for external edits.

### Permissions and effects

Review imported mod code before use. T3 mods run Git, shell, and `hc` commands and can read or change files and repositories. See upstream [What it runs](https://github.com/JinJieBeWater/herdr-t3/blob/9a9fd18c88d3312577382944b42593c7d27e98fb/README.md#what-it-runs).

Git operations can run configured filters, hooks, and signing programs. Rollback discards selected changes; amend rewrites history. Fetch, pull, push, and remote branch deletion access the network. Force push can discard remote commits. Avoid concurrent Git operations in the same checkout.

Git Graph checks GitHub's public releases API at most once a day. Choose **Stop checking** in its update window or set `CHECK = false` in the installed `git-graph/update.js`. Replacing the mod can restore that setting.

Herdr T3 is Apache-2.0; see [`herdr/LICENSE`](herdr/LICENSE). Git Graph is MIT; see [`herdr/mods/git-graph/LICENSE`](herdr/mods/git-graph/LICENSE). Its copied graph icon is also used in T3 chrome; see Git Graph's [Lucide notice](herdr/mods/git-graph/icons/LICENSE-lucide.txt). The imported mod notices and bundled licenses retain third-party attribution. T3 upstream credits Herdr App, Lucide, Catppuccin icons, and uFuzzy; see its [credits](https://github.com/JinJieBeWater/herdr-t3/blob/9a9fd18c88d3312577382944b42593c7d27e98fb/README.md#credits-and-license).

## Conventions

Group reusable content by tool, use descriptive kebab-case names, and document dependencies and permissions. Keep credentials, transcripts, and machine-specific configuration out of the repository. The npm package is private to prevent accidental publication.

See the [Oh My Pi documentation](https://github.com/can1357/oh-my-pi/tree/main/docs) and [extension authoring guide](https://github.com/can1357/oh-my-pi/blob/main/docs/skills/authoring-extensions.md).
