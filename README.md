# Personal AI agent toolkit

A personal collection of extensions, skills, prompts, and configuration for the tools I use to work with AI agents. Content is grouped by tool rather than tied to a single agent.

The current collection contains [Oh My Pi](https://github.com/can1357/oh-my-pi) settings and skills under `omp/`. The local `nono/` directory is currently empty; Git does not track empty directories.

## Layout

| Path | Contents |
| --- | --- |
| `omp/extensions/` | Oh My Pi TypeScript or JavaScript extensions: tools, commands, and event handlers. Currently contains only `.gitkeep`. |
| `omp/skills/` | Skill directories, each containing a `SKILL.md` and any supporting references. |
| `omp/agent/config.yml` | Personal Oh My Pi configuration: model roles, fallback chains, UI, and tool settings. |
| `omp/agent/RULES.md` | Always-loaded routing policy for the five bundled skills. |
| `omp/agent/lsp.json` | Oh My Pi language server configuration. |
| `omp/agent/mcp.json` | Oh My Pi MCP server configuration. |
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
