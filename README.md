# Personal AI agent toolkit

Personal extensions, skills, and configuration for [Oh My Pi](https://github.com/can1357/oh-my-pi), plus a [nono](https://nono.sh/docs) sandbox profile.

## Layout

| Path | Contents |
| --- | --- |
| `omp/extensions/` | English reviewer extension. |
| `omp/skills/` | CloudEvents, EventStorming, functional thinking, Git commits, and UI design skills. |
| `omp/agent/` | Model/tool settings, skill routing, personality, LSP, and MCP configuration. |
| `nono/profiles/omp.json` | Sandbox profile for Go, JavaScript, .NET, and browser tooling. |

## Oh My Pi

Requires **Oh My Pi 18.11.2+**. Extensions run as TypeScript without a build. Run commands from this repository's root.

### Configuration and installation

Review provider/model choices, then load the settings for one session:

```sh
omp --config ./omp/agent/config.yml
```

For persistent settings, merge the desired values from `omp/agent/config.yml`, `lsp.json`, and `mcp.json` into their counterparts in your active agent directory. Do not overwrite existing configuration blindly.

Link the always-loaded skill routing and personality, install the skills, and register the extension:

```sh
agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.omp/agent}"
mkdir -p "$agent_dir/skills"
ln -s "$PWD/omp/agent/RULES.md" "$agent_dir/RULES.md"
ln -s "$PWD/omp/agent/PERSONALITY.md" "$agent_dir/PERSONALITY.md"
for skill in cloudevents event-storming functional-thinking git-commit ui-component-design; do
  ln -s "$PWD/omp/skills/$skill" "$agent_dir/skills/$skill"
done
omp plugin link .
```

These links do not overwrite existing files; merge existing rules or personality instructions as needed. For named profiles or XDG layouts, set `agent_dir` to the active agent directory. Root plugin linking does **not** discover the nested skills, so keep the explicit skill links.

Start a new session after installation. Keep rules and skills enabled. The routing policy stays loaded; full skills load on demand. The custom personality replaces the selected preset unless `personality` is `none`; task subagents do not inherit it. `--config` alone installs neither file.

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
  "$HOME/.dotnet" "$HOME/.nuget" "$HOME/.templateengine" \
  "${XDG_CACHE_HOME:-$HOME/.cache}" \
  "${XDG_CONFIG_HOME:-$HOME/.config}/git" \
  "${XDG_DATA_HOME:-$HOME/.local/share}/NuGet"
export PATH="$HOME/.bun/bin:$HOME/go/bin:$HOME/.dotnet/tools:$HOME/.local/bin:$PATH"
nono profile validate ./nono/profiles/omp.json
nono run --profile ./nono/profiles/omp.json -- omp
```

Initialize your Node version manager first if needed; the sandbox inherits `PATH`. Review the profile's broad filesystem grants, deployment-specific `/base` and `/ralplan` paths, and any custom tool/cache locations. Git identity access does not imply credential access.

The `developer` network policy covers common registries, Git hosts, documentation, and AI providers, with additions for Go, NuGet, Bun, and Penpot. Local server ports are **3000, 5000, 5001, and 5173**; add others with `--open-port <port>`. Enumerated `192.168.1.*` addresses affect proxy routing, not TCP permissions.

For MCP, merge `omp/agent/mcp.json` into your active configuration. Set `PENPOT_TOKEN` outside the repository and connect the Penpot MCP plugin in the design file. Playwright runs headless Chrome with `--no-sandbox` (disabling Chrome's sandbox, not nono's). Remote browsing through nono's proxy requires explicit Playwright `browser.launchOptions.proxy` settings with the current server and separate username/password; Chrome does not automatically use `HTTPS_PROXY`. Keep destination domains allowed rather than weakening network isolation.

## Conventions

Group reusable content by tool, use descriptive kebab-case names, and document dependencies and permissions. Keep credentials, transcripts, and machine-specific configuration out of the repository. The npm package is private to prevent accidental publication.

See the [Oh My Pi documentation](https://github.com/can1357/oh-my-pi/tree/main/docs) and [extension authoring guide](https://github.com/can1357/oh-my-pi/blob/main/docs/skills/authoring-extensions.md).
