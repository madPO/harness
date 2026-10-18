# Personal AI agent toolkit

A personal collection of extensions, skills, prompts, and configuration for the tools I use to work with AI agents. Content is grouped by tool rather than tied to a single agent.

The current collection contains [Oh My Pi](https://github.com/can1357/oh-my-pi) settings and skills under `omp/`, and a [nono](https://nono.sh/docs) sandbox profile under `nono/`.

## Layout

| Path | Contents |
| --- | --- |
| `omp/extensions/` | Oh My Pi TypeScript or JavaScript extensions: tools, commands, and event handlers. Currently contains only `.gitkeep`. |
| `omp/skills/` | Skill directories, each containing a `SKILL.md` and any supporting references. |
| `omp/agent/config.yml` | Personal Oh My Pi configuration: model roles, fallback chains, UI, and tool settings. |
| `omp/agent/RULES.md` | Always-loaded routing policy for the five bundled skills. |
| `omp/agent/lsp.json` | Oh My Pi language server configuration. |
| `omp/agent/mcp.json` | Oh My Pi MCP server configuration. |
| `nono/profiles/omp.json` | Oh My Pi sandbox profile with Go, JavaScript, .NET, and browser tooling access. |
| `package.json` | Private npm package metadata and Oh My Pi extension entry points. |

`.gitkeep` files preserve otherwise empty directories in Git; remove each one when adding real content to its directory.

## Oh My Pi

Requires an installed `omp` CLI. There are no dependencies or build steps yet. Run the following commands from this repository's root.

### Configuration

`omp/agent/config.yml` contains personal settings, not a snapshot of built-in defaults. Review the model and provider choices before using it.

Load it explicitly for a session:

```sh
omp --config ./omp/agent/config.yml
```

The file is not loaded automatically from this repository. `--config` applies it as an overlay for that run.

To use these settings by default, merge the desired values into your existing `~/.omp/agent/config.yml` (or your active profile/XDG equivalent). Likewise, merge the needed entries from `omp/agent/lsp.json` and `omp/agent/mcp.json` into the corresponding files in your agent directory. Do not overwrite existing personal configuration blindly.

### Always-loaded skill routing

`omp/agent/RULES.md` routes tasks to the five skills in `omp/skills/`. Install it as **`~/.omp/agent/RULES.md`**, not `~/.omp/RULES.md`. Oh My Pi treats this user-level file as an always-apply rule: its full content stays in the system prompt on every request, including after compaction. The routing policy is always loaded; full skill instructions and references load only when relevant.

Link both the policy and the skill directories:

```sh
agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.omp/agent}"
mkdir -p "$agent_dir/skills"
ln -s "$PWD/omp/agent/RULES.md" "$agent_dir/RULES.md"
for skill in cloudevents event-storming functional-thinking git-commit ui-component-design; do
  ln -s "$PWD/omp/skills/$skill" "$agent_dir/skills/$skill"
done
```

These commands deliberately do not overwrite existing files. If you already have a `RULES.md`, merge this repository's routing policy into it instead of replacing your existing instructions. If any named skill is already installed, check its source before choosing which copy to keep.

For a named profile, set `agent_dir` to that profile's agent directory (normally `~/.omp/profiles/<name>/agent`); use your configured agent directory for an XDG layout. Repeat the installation for each profile that needs the policy. Keep rule and skill discovery enabled: do not start these sessions with `--no-rules` or `--no-skills`.

Start a new Oh My Pi session from any project after installation. The policy applies globally for that agent directory, without a manual prompt or `/skill:` invocation. Symlinks pick up repository changes on new sessions; if you prefer copies, copy `omp/agent/RULES.md` to your agent directory as `RULES.md`, copy the complete directories from `omp/skills/` (including references) into its `skills/` directory, and update them when the collection changes.

### Extensions and package discovery

There are no extension modules yet. Once an extension exists, try it directly:

```sh
omp --no-extensions --extension ./omp/extensions/my-extension.ts
```

That command requires the named file to exist. `--no-extensions` disables ambient extension discovery; the explicit extension still loads.

Register extension entry points in the root `package.json` under `omp.extensions`, using repository-relative paths such as `"./omp/extensions/my-extension.ts"`. Keep the list empty until a real extension exists; do not add legacy `pi` manifest fields.

Oh My Pi discovers bundled skills and prompts as siblings of a loaded plugin package. Linking this repository's root with `omp plugin link .` does not make the nested `omp/skills/` directory a sibling of the root manifest. Use the explicit skill links above for this layout.

## nono

`nono/profiles/omp.json` extends the registry-managed `nolabs-ai/pi` profile. That base must be installed; this is not a standalone profile. The runtime CLIs and Google Chrome must already be installed. The sandbox inherits the launcher's `PATH`; permissions do not install tools or add their directories to `PATH`.

Before starting the sandbox, create any missing cache/configuration roots from an ordinary host shell. nono skips grants for paths that do not exist; the sandbox cannot create these directories under an otherwise unshared home directory:

```sh
mkdir -p "$HOME/.bun" "$HOME/.npm" "$HOME/go" \
  "$HOME/.dotnet" "$HOME/.nuget" "$HOME/.templateengine" \
  "${XDG_CACHE_HOME:-$HOME/.cache}" \
  "${XDG_CONFIG_HOME:-$HOME/.config}/git" \
  "${XDG_DATA_HOME:-$HOME/.local/share}/NuGet"
export PATH="$HOME/.bun/bin:$HOME/go/bin:$HOME/.dotnet/tools:$HOME/.local/bin:$PATH"
```

Initialize your Node version manager in the host shell if needed. Load the repository profile explicitly rather than relying on a user-installed `omp` profile:

```sh
nono profile validate ./nono/profiles/omp.json
nono run --profile ./nono/profiles/omp.json -- omp
```

Filesystem grants are grouped by workspace/agent/cache, Bun/Node.js, Go, .NET/NuGet, browser, system runtime, temporary storage, and deployment-specific paths. Domain grants follow the same tooling groups, with local access last. Blank lines separate groups while keeping the file valid JSON.

| Component | Access |
| --- | --- |
| Bun and Node.js | Writable Bun/npm/npx caches; inherited read access to Node version managers and user-local executables; XDG fnm/pnpm and user-local Node modules are readable. |
| Go | Writable default GOPATH (`~/go`), including installed tools and unpacked modules; writable build cache and Go environment file; Go module proxy, checksum, and common vanity-import hosts allowed. |
| .NET | Writable CLI state/global tools, NuGet package/HTTP caches, and template-engine state; access to standard system SDK locations. |
| Git | Inherited read access to `~/.gitconfig` and global ignore/attribute files; read access to the XDG Git directory, including configuration fragments stored there. |
| MCP/browser | Penpot's HTTPS MCP endpoint and Playwright download CDNs allowed; Chrome installation, Playwright browser cache, persistent automation profiles, temporary files, and shared memory accessible. |

Home paths use `$HOME`; config, data, and cache paths use `$XDG_CONFIG_HOME`, `$XDG_DATA_HOME`, and `$XDG_CACHE_HOME`, with nono's standard home-relative fallbacks. `$WORKDIR` resolves to the current directory or `--workdir`. No username or fixed checkout path is embedded. Non-default `GOPATH`, `GOMODCACHE`, `NUGET_PACKAGES`, or other custom runtime locations outside these grants need explicit permissions.

Directory grants are recursive, so covered child paths and weaker duplicate grants are omitted. Go's `env` file and the Chrome executable use `allow_file`. `/base` and `/ralplan` retain their original deployment-specific locations; adjust them if your installation uses different paths. Git configuration includes, hooks, signing keys, and credential helpers outside the granted locations need separate review; Git identity access does not imply credential access.

The profile preserves broad read/write access to the listed toolchain and system directories; this cleanup does not harden those permissions. `commands.allow` retains the existing `gopls` startup exception, which nono marks deprecated and does not enforce on child processes. `gopls` and `roslyn-language-server` in `omp/agent/lsp.json` must be installed separately.

The `developer` network policy provides package-registry, Git-host, documentation, and AI-provider access; explicit additions cover Go, NuGet, Bun, and Penpot. Local TCP ports 3000, 5000, 5001, and 5173 support common Bun/Node.js, ASP.NET Core, and Vite servers. For another development-server port, pass `--open-port <port>` at launch rather than granting a broad range.

`network.no_proxy` and `network.upstream_bypass` include every address from `192.168.1.0` through `192.168.1.255`. nono 0.74 requires literal IP entries here rather than IPv4 trailing wildcards or CIDR notation, so the range is enumerated explicitly. These entries change proxy routing, not sandbox TCP permissions; upstream bypass applies when an upstream proxy is configured.

Merge `omp/agent/mcp.json` into your active agent MCP configuration. Penpot uses the `PENPOT_TOKEN` environment variable; do not put its value in the profile or repository. Open the Penpot MCP plugin in the design file and connect it using the matching token. A reachable MCP endpoint alone does not connect a design instance.

Playwright MCP retains the original command: `npx @playwright/mcp@latest --headless --no-sandbox`. No browser, isolation, or npm-confirmation override is added. The currently installed version defaults to Google Chrome with a persistent per-workspace automation profile under `$XDG_CACHE_HOME/ms-playwright-mcp` (normally `~/.cache/ms-playwright-mcp`); downloaded browsers use `$XDG_CACHE_HOME/ms-playwright`. Both are covered by the existing cache-root grant, without duplicate child grants. The automation profile is separate from the protected personal Chrome profile. The `--no-sandbox` option disables Chrome's own sandbox, not nono's boundary.

nono's filtered network mode requires its local proxy to bind a localhost port. The MCP smoke check covers default-browser launch and page interaction, not remote browsing through that proxy: Chrome does not automatically use `HTTPS_PROXY`. Remote navigation requires an explicit Playwright `browser.launchOptions.proxy` configuration with the current proxy server and separate username/password, plus allowed destination domains. Do not weaken `wsl2_proxy_policy` or open direct outbound ports to work around missing proxy configuration.

## Repository conventions

- Group each tool's reusable content under its own top-level directory.
- Keep credentials, session transcripts, and machine-specific configuration out of the repository.
- Use descriptive, kebab-case names for extensions, prompts, and skill directories.
- Document how to use each addition and any required dependencies or permissions.
- Add dependencies, type checking, and tests when actual extension code needs them.
- The npm package is private to prevent accidental publication.

## References

- [Oh My Pi extension authoring and package discovery](https://github.com/can1357/oh-my-pi/blob/main/docs/skills/authoring-extensions.md)
- [Oh My Pi documentation](https://github.com/can1357/oh-my-pi/tree/main/docs)
