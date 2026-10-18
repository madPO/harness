# Personal Oh My Pi collection

A home for personal [Oh My Pi](https://github.com/can1357/oh-my-pi) extensions, prompt templates, skills, and themes.

## Layout

| Path | Contents |
| --- | --- |
| `extensions/` | TypeScript or JavaScript extensions: tools, commands, and event handlers. |
| `skills/` | Skill directories, each containing a `SKILL.md`. |
| `config.yml` | Snapshot of Oh My Pi's built-in configuration defaults. |
| `agent/RULES.md` | Always-loaded routing policy for the skills in this collection. |
| `agent/lsp.json` | Oh My Pi language server configuration. |
| `agent/mcp.json` | Oh My Pi MCP server configuration. |

`.gitkeep` files preserve otherwise empty directories in Git; remove each one when adding real content to its directory.

## Local use

Requires an installed `omp` CLI. There are no dependencies or build steps yet.

After adding content, link this repository from its root:

```sh
omp plugin link .
```

This modifies your user-level plugin installation. Add `--local` to link only into the current project's plugin directory instead. Restart Oh My Pi after changing the linked collection.

Register each extension entry point explicitly in `package.json` under `omp.extensions`, for example `"./extensions/my-extension.ts"`. Keep the list empty until a real extension exists. Oh My Pi discovers sibling `prompts/` and `skills/` directories from loaded plugin packages; do not add legacy `pi` manifest fields.

To try an individual extension without linking the collection:

```sh
omp --no-extensions --extension ./extensions/my-extension.ts
```

That command requires the named file to exist. `--no-extensions` disables ambient extension discovery; the explicit extension still loads.

## Default configuration

`config.yml` contains the built-in defaults from **omp v18.11.2**, extracted from its settings registry rather than your personal configuration. Settings with no default and credential fields are omitted.

Load it explicitly from this directory:

```sh
omp --config ./config.yml
```

The root-level file is not automatically applied by linking this collection. With `--config`, its values override matching global and project settings; environment and CLI overrides may still take precedence. Edit the snapshot to customize it and review it when upgrading Oh My Pi.

To use it as your default user configuration, merge the desired settings into your existing `~/.omp/agent/config.yml` (or your active profile/XDG equivalent). Do not overwrite an existing personal configuration blindly.

## Always-loaded skill routing

`agent/RULES.md` routes tasks to the five skills in this collection. Install it as **`~/.omp/agent/RULES.md`**, not `~/.omp/RULES.md`. Oh My Pi treats this user-level file as an always-apply rule: its full content stays in the system prompt on every request, including after compaction. The routing policy is always loaded; full skill instructions and references load only when relevant.

From this repository's root, link both the policy and the skill directories:

```sh
agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.omp/agent}"
mkdir -p "$agent_dir/skills"
ln -s "$PWD/agent/RULES.md" "$agent_dir/RULES.md"
for skill in cloudevents event-storming functional-thinking git-commit ui-component-design; do
  ln -s "$PWD/skills/$skill" "$agent_dir/skills/$skill"
done
```

These commands deliberately do not overwrite existing files. If you already have a `RULES.md`, merge this repository's routing policy into it instead of replacing your existing instructions. If any named skill is already installed, check its source before choosing which copy to keep. If the collection is already linked as a plugin and all five skills are discovered, only install/merge `RULES.md`; duplicate skill links are unnecessary.

For a named profile, set `agent_dir` to that profile's agent directory (normally `~/.omp/profiles/<name>/agent`); use your configured agent directory for an XDG layout. Repeat the installation for each profile that needs the policy. Keep rule and skill discovery enabled: do not start these sessions with `--no-rules` or `--no-skills`.

Start a new Oh My Pi session from any project after installation. The policy applies globally for that agent directory, without a manual prompt or `/skill:` invocation. Symlinks pick up repository changes on new sessions; if you prefer copies, copy `agent/RULES.md` to your agent directory as `RULES.md`, copy the complete skill directories (including references) into its `skills/` directory, and update them when the collection changes.

## Repository conventions

- Keep reusable content here, not credentials, session transcripts, or machine-specific configuration.
- Use descriptive, kebab-case names for extensions, prompts, and skill directories.
- Document how to use each addition and any required dependencies or permissions.
- Add dependencies, type checking, and tests when actual extension code needs them.
- The package is private to prevent accidental npm publication. No license or Git remote has been chosen.

## References

- [Extension authoring and package discovery](https://github.com/can1357/oh-my-pi/blob/main/docs/skills/authoring-extensions.md)
- [Oh My Pi documentation](https://github.com/can1357/oh-my-pi/tree/main/docs)
