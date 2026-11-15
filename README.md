# Personal AI agent toolkit

Personal extensions, skills, and configuration for [Oh My Pi](https://github.com/can1357/oh-my-pi), a [nono](https://nono.sh/docs) sandbox profile, and a Herdr layout.

## Layout

| Path | Contents |
| --- | --- |
| `omp/extensions/` | English reviewer extension. |
| `omp/skills/` | Code review, CloudEvents, EventStorming, functional thinking, Git commits, and UI design skills. |
| `omp/agent/` | Specialist task agents, model/tool settings, skill routing, personality, LSP, and MCP configuration. |
| `nono/profiles/madpo.json` | Sandbox profile for Go, JavaScript, Rust, .NET, and browser tooling. |
| `herdr/` | Herdr T3 layout, mods, key bindings, and upstream license. |

## Oh My Pi

Requires **Oh My Pi 18.11.2+**. Extensions run as TypeScript without a build. Run commands from this repository's root.

### Configuration and installation

Review provider/model choices, then load the settings for one session:

```sh
omp --config ./omp/agent/config.yml
```

For persistent settings, merge the desired values from `omp/agent/config.yml`, `lsp.json`, and `mcp.json` into their counterparts in your active agent directory. Do not overwrite existing configuration blindly.

Link the always-loaded skill routing and personality, install the skills and task agents, and register the extension:

```sh
agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.omp/agent}"
mkdir -p "$agent_dir/skills" "$agent_dir/agents"
ln -s "$PWD/omp/agent/RULES.md" "$agent_dir/RULES.md"
ln -s "$PWD/omp/agent/PERSONALITY.md" "$agent_dir/PERSONALITY.md"
for skill in code-review cloudevents event-storming functional-thinking git-commit ui-component-design; do
  ln -s "$PWD/omp/skills/$skill" "$agent_dir/skills/$skill"
done
for agent in "$PWD"/omp/agent/agents/*.md; do
  ln -s "$agent" "$agent_dir/agents/"
done
omp plugin link .
```

These links do not overwrite existing files; merge existing rules, personality instructions, or agent definitions as needed. For named profiles or XDG layouts, set `agent_dir` to the active agent directory. Root plugin linking does **not** discover the nested skills or agents, so keep the explicit links.

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

Compatibility: native commit inputs retain their built-in accessibility roles instead of overriding them with web role names.

Install from this repository's root:

1. Back up `~/.config/herdr-app/`, including existing `layouts/`, `mods/`, and `keys.json`.
2. Create `~/.config/herdr-app/layouts/` and `~/.config/herdr-app/mods/` if needed. Inspect destinations before copying; reconcile existing customizations rather than overwriting them blindly.
3. Copy `herdr/layouts/herdr-t3.json` and `herdr/layouts/herdr-t3.svg` into the app's `layouts/` directory, or merge the Changes block into a customized layout. Preserve its `changes` block ID and set its content mod to `t3-changes`. Replacing a layout can discard its theme, focus ring, sidebar state, or added blocks.
4. Copy each directory in `herdr/mods/t3-*` and `herdr/mods/git-graph` into the app's `mods/` directory. Include `t3-changes`, `t3-files`, `git-graph`, and `t3-chrome`. Copy every file in `t3-changes`, including `tree-row.js`, `file-icons.js`, and `file-icons-data.js`. Changes uses its local tree renderer and icon resolver. The installed T3 Files mod supplies icon assets; Git Graph supplies the refresh icon. Changes does not import JavaScript from sibling mods. Reconcile any existing mod customizations first. Use real copies, not symlinks: upstream says mod SVGs do not load through symlinks.
5. Merge `herdr/keys.json` into `~/.config/herdr-app/keys.json`. If no file exists, copy it there. Otherwise, merge each section and key, retaining unrelated sections and bindings. Choose explicitly between conflicting bindings. The file includes the original global and terminal bindings alongside T3 layout and mod bindings. Layout-scoped shortcuts may override global shortcuts.
6. Select `herdr-t3` in Herdr's layout picker. See the [T3 guide](https://github.com/JinJieBeWater/herdr-t3/blob/9a9fd18c88d3312577382944b42593c7d27e98fb/docs/user/guide.md) for usage and key commands.

The T3 bindings target macOS. On Linux and Windows, Herdr defaults can bypass layout rules, including close confirmation and Home-aware space numbering. Rebind those keys manually as described in the [upstream key guide](https://github.com/JinJieBeWater/herdr-t3/blob/9a9fd18c88d3312577382944b42593c7d27e98fb/docs/user/guide.md#keys).

Open the right-side panel with its existing button or binding, then select **Git** beside **Files**. The panel button reopens the last selected page. Git Graph follows the focused terminal's repository and offers commit details, diffs, and Git actions. In a folder containing repositories, its Manygit view lists them. See the [Git Graph guide](https://github.com/rabeeh-ta/herdr-git-graph/tree/0da886243b2e27a6068d6adb7c5c26f349cdc04e#what-it-does) for its actions and limits. Manygit requires `find` and `env` and does not work on Windows.

Select **Changes** in the same panel to inspect uncommitted work in the focused terminal's repository. The diff appears on the left; staged and unstaged file trees appear on the right. Files with both kinds of changes appear in both groups. Expand folders, select files, and use **+** or **−** to stage or unstage individual files. Use **Stage all** or **Unstage all** for the corresponding group. Enter a required subject and optional single-line description, then select **Commit**. Commit includes staged changes only; Changes never stages files implicitly. Resolve conflicts outside Changes; conflict files cannot be staged or committed here. Git Graph's **Open Changes** and **Show in Changes panel** actions still select this page.

Changes shares T3 Files' compact 24px rows, centered file-type icons, SVG chevrons, aligned columns, and rounded selection. Small trailing badges show Git status beside centered stage and unstage controls. The diff keeps its filename header, numbered content rows, and meaningful notes, without staged/unstaged labels, hunk headers, or raw mode metadata.

Changes refreshes when opened, when the repository context changes, and after stage, unstage, or commit actions. Use **Refresh** to reread external edits or Git operations; Changes does not poll or refresh from Git Graph notifications. Refresh preserves the displayed same-file diff until its replacement arrives. Repository mutations still show progress and errors. Wide panels fill the available height and top-align both headers. The file tree grows above the bottom-anchored commit form. Narrow panels stack the diff above the Changes sidebar and keep vertical scrolling available.

Keyboard users can Tab through controls and inputs. In the file tree, use arrow keys to navigate, Enter to select or expand, and Space to stage or unstage. Left and Right collapse and expand folders or groups. Commit drafts stay in memory per machine and repository until a successful commit or view closure.

**Permissions and effects:** Review the imported mod code before using it. T3 mods run Git, shell, and `hc` commands; they inspect local or remote space files and repositories. They write agent labels and caches, and Actions runs user-defined shell commands. Machine Connect can remove and add an `hc` machine; file actions can open local files or use the clipboard. On macOS, zoom changes can rewrite the installed layout. T3 upstream reports no network requests by the layout itself. See upstream [What it runs](https://github.com/JinJieBeWater/herdr-t3/blob/9a9fd18c88d3312577382944b42593c7d27e98fb/README.md#what-it-runs) for details.

Git Graph runs Git on the focused repository's machine and reads untracked files for diffs. Manygit scans folders and periodically checks listed repositories; Git status can run repository-configured clean filters. Fetch, pull, push, and remote branch deletion can access the network. Git actions can change repositories, including destructive resets; review each action's confirmation. Local branch checkout and Fetch run without confirmation.

Changes runs Git through argument arrays on the focused repository's machine, including remote machines. It reads repository status and diffs without optional index locks, external diff drivers, or textconv. Untracked previews use Git's no-index diff; symbolic links show the link target, not the target's contents. Git may still run repository-configured clean filters during status and staging. Stage and unstage change the index; commit writes a local commit and can invoke configured Git hooks or signing programs. No discard, hard reset, push, review delivery, model request, or updater is included.

Changes checks repository HEAD and branch before mutations and rejects actions after focus changes. External Git operations can still race after preflight; finish concurrent Git work before mutating the same checkout. Git errors preserve the commit draft. Changes publishes mutation notifications so Git Graph can refresh. To update Changes, reconcile and recopy `herdr/mods/t3-changes/`; no background downloads or separate build step are required.

Git Graph also checks GitHub's public releases API at most once a day without a token or repository details. The request still reaches GitHub. The mod does not update itself. Choose **Stop checking** in its update window to disable future checks, or set `CHECK = false` in the installed `git-graph/update.js` before use. Replacing the mod can restore that code setting. See upstream [What it runs](https://github.com/rabeeh-ta/herdr-git-graph/blob/0da886243b2e27a6068d6adb7c5c26f349cdc04e/README.md#what-it-runs) and [Updating](https://github.com/rabeeh-ta/herdr-git-graph/blob/0da886243b2e27a6068d6adb7c5c26f349cdc04e/README.md#updating).

Herdr T3 is Apache-2.0; see [`herdr/LICENSE`](herdr/LICENSE). Git Graph is MIT; see [`herdr/mods/git-graph/LICENSE`](herdr/mods/git-graph/LICENSE). Its copied graph icon is also used in T3 chrome; see Git Graph's [Lucide notice](herdr/mods/git-graph/icons/LICENSE-lucide.txt). The imported mod notices and bundled licenses retain third-party attribution. T3 upstream credits Herdr App, Lucide, Catppuccin icons, and uFuzzy; see its [credits](https://github.com/JinJieBeWater/herdr-t3/blob/9a9fd18c88d3312577382944b42593c7d27e98fb/README.md#credits-and-license).

## Conventions

Group reusable content by tool, use descriptive kebab-case names, and document dependencies and permissions. Keep credentials, transcripts, and machine-specific configuration out of the repository. The npm package is private to prevent accidental publication.

See the [Oh My Pi documentation](https://github.com/can1357/oh-my-pi/tree/main/docs) and [extension authoring guide](https://github.com/can1357/oh-my-pi/blob/main/docs/skills/authoring-extensions.md).
