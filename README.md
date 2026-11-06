# Personal AI agent toolkit

Personal extensions, skills, and configuration for [Oh My Pi](https://github.com/can1357/oh-my-pi), plus a [nono](https://nono.sh/docs) sandbox profile.

## Layout

| Path | Contents |
| --- | --- |
| `omp/extensions/` | English reviewer extension. |
| `omp/skills/` | Code review, CloudEvents, EventStorming, functional thinking, Git commits, and UI design skills. |
| `omp/agent/` | Specialist task agents, model/tool settings, skill routing, personality, LSP, and MCP configuration. |
| `nono/profiles/omp.json` | Sandbox profile for Go, JavaScript, Rust, .NET, and browser tooling. |

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

The profile extends **`nolabs-ai/pi`**, which must already be installed. Install the runtime CLIs, language servers, and Google Chrome separately. From an ordinary host shell, create cache/configuration roots before launching; nono skips grants for missing paths:

```sh
mkdir -p "$HOME/.bun" "$HOME/.npm" "$HOME/go" \
  "$HOME/.cargo" "$HOME/.rustup" \
  "$HOME/.dotnet" "$HOME/.nuget" "$HOME/.templateengine" \
  "${XDG_CACHE_HOME:-$HOME/.cache}" \
  "${XDG_CONFIG_HOME:-$HOME/.config}/git" \
  "${XDG_DATA_HOME:-$HOME/.local/share}/NuGet"
export PATH="$HOME/.cargo/bin:$HOME/.bun/bin:$HOME/go/bin:$HOME/.dotnet/tools:$HOME/.local/bin:$PATH"
nono profile validate ./nono/profiles/omp.json
nono run --profile ./nono/profiles/omp.json -- omp
```

Initialize your Node version manager first if needed; the sandbox inherits `PATH`. Review the profile's broad filesystem grants, deployment-specific `/base` and `/ralplan` paths, and any custom tool/cache locations. Git identity access does not imply credential access.

For Rust, install rustup, a Rust toolchain, and a native linker (for example, the Linux `build-essential` package) on the host first. Add the `rust-analyzer`, `rustfmt`, and `clippy` rustup components for language-server, formatting, and lint support. The profile grants write access to the default `$HOME/.cargo` and `$HOME/.rustup` directories for registry/git caches, Cargo locks, installed tools, and toolchain updates; project builds and executables stay under `$WORKDIR`. System headers are readable for crates that build native dependencies; install any required native development packages on the host. If you override `CARGO_HOME`, `RUSTUP_HOME`, or `CARGO_TARGET_DIR` outside the granted paths, add those locations with `--allow <directory>` before launching. From your Rust project directory, use `nono run --profile /absolute/path/to/harness/nono/profiles/omp.json -- cargo run` (or `cargo check`, `cargo test`, `cargo fmt`, or `cargo clippy`).

The `developer` network policy covers common registries, Git hosts, documentation, and AI providers, with additions for Go, NuGet, Bun, Rust/crates.io (including the sparse index, crate downloads, and rustup distribution servers), and Penpot. Local server ports are **3000, 5000, 5001, 5173, 8000, and 8080**; add others with `--open-port <port>`. Enumerated `192.168.1.*` addresses affect proxy routing, not TCP permissions.

For MCP, merge `omp/agent/mcp.json` into your active configuration. Set `PENPOT_TOKEN` outside the repository and connect the Penpot MCP plugin in the design file. Playwright runs headless Chrome with `--no-sandbox` (disabling Chrome's sandbox, not nono's). Remote browsing through nono's proxy requires explicit Playwright `browser.launchOptions.proxy` settings with the current server and separate username/password; Chrome does not automatically use `HTTPS_PROXY`. Keep destination domains allowed rather than weakening network isolation.

## Conventions

Group reusable content by tool, use descriptive kebab-case names, and document dependencies and permissions. Keep credentials, transcripts, and machine-specific configuration out of the repository. The npm package is private to prevent accidental publication.

See the [Oh My Pi documentation](https://github.com/can1357/oh-my-pi/tree/main/docs) and [extension authoring guide](https://github.com/can1357/oh-my-pi/blob/main/docs/skills/authoring-extensions.md).
