---
name: git-commit
description: "Generate well-structured git commit messages following Conventional Commits specification. Use when the user asks to write a commit message, format a commit, describe changes as a commit, or generate a git commit. Always appends Assisted-by: AI-agent footer trailer. Supports types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert."
metadata:
  author: social@madpo.me
  version: '1.0'
---

# Git Commit Skill

## When to Use This Skill

Use this skill when the user:

- Asks to write or generate a commit message
- Provides a diff, code change description, or list of changes and wants a commit
- Asks to format or improve an existing commit message
- Uses phrases like "write a commit", "commit message for", "commit this", "format my commit"

## Conventional Commits Format

```
<type>(<scope>): <short summary>

[optional body]

[optional footers]
Assisted-by: AI-agent
```

### Rules

- **Header line**: max 72 characters
- **Type**: lowercase, one of the allowed types below
- **Scope**: optional, lowercase, noun in parentheses — describes the affected module/package/area (e.g. `auth`, `api`, `db`, `ci`)
- **Summary**: imperative mood, lowercase, no period at the end ("add feature" not "added feature" or "adds feature"). Compact size 2 or 3 bullets.
- **Body**: optional, wrapped at 72 chars, **maximum 3 lines**. Only state the main points — explain *what* and *why* (not *how*); separated from header by a blank line
- **Footers**: key-value trailers separated from body by a blank line; `BREAKING CHANGE:` must be included for breaking changes
- **`Assisted-by: AI-agent`**: ALWAYS the last line of the commit message, no exceptions

### Allowed Types

| Type       | When to use                                                    |
|------------|----------------------------------------------------------------|
| `feat`     | A new feature (triggers MINOR in semver)                       |
| `fix`      | A bug fix (triggers PATCH in semver)                           |
| `docs`     | Documentation-only changes                                     |
| `style`    | Formatting, whitespace, missing semicolons — no logic changes  |
| `refactor` | Code change that is neither a fix nor a feature                |
| `perf`     | Code change that improves performance                          |
| `test`     | Adding or correcting tests                                     |
| `build`    | Build system or external dependency changes (npm, nuget, etc.) |
| `ci`       | CI/CD configuration changes                                    |
| `chore`    | Maintenance tasks that don't modify src or test files          |
| `revert`   | Reverts a previous commit                                      |

### Breaking Changes

If the change is breaking, add `!` after type/scope and include a `BREAKING CHANGE:` footer:

```
feat(api)!: remove deprecated /v1/users endpoint

BREAKING CHANGE: /v1/users has been removed. Use /v2/users instead.
Assisted-by: AI-agent
```

## Instructions

1. **Analyze the input**: Read the diff, change description, or user's explanation to understand what changed and why.

2. **Choose the type**: Pick the single most appropriate type from the table above. When in doubt between `feat` and `refactor`, ask yourself: does this add user-visible behavior? If yes → `feat`.

3. **Determine the scope** (optional but recommended): Identify the primary area affected. Use the module name, package name, or a short noun. Skip scope only if the change is truly global or cross-cutting.

4. **Write the summary**: One line, imperative mood, lowercase, no trailing period. Be specific — avoid vague summaries like "update stuff" or "fix bug".

5. **Write the body** (if the change is non-trivial): **Maximum 3 lines.** Only write the main points — the core motivation or the key decisions. Do not repeat what the diff already shows. If you cannot summarize in 3 lines, you are being too detailed.

6. **Add footers**: Include any relevant trailers such as `Fixes #123`, `Closes #456`, `Co-authored-by:`, `BREAKING CHANGE:`, etc. Always add `Assisted-by: AI-agent` as the final line.

7. **Output the commit message** in a fenced code block for easy copying:

```
git commit -m "..."
```
Or as a multi-line message:
````
```
feat(auth): add OAuth2 PKCE flow for SPA clients

Replace implicit flow with PKCE to improve security for browser-based
apps. Authorization code is now exchanged with a code verifier,
eliminating the risk of token interception.

Closes #87
Assisted-by: AI-agent
```
````

## Examples

### Minimal (no body needed)

```
fix(parser): handle null token in expression evaluator

Assisted-by: AI-agent
```

### With body

```
refactor(queue): replace RabbitMQ client with NATS JetStream

RabbitMQ required a separate broker with no built-in persistence.
NATS JetStream provides at-least-once delivery and embeds directly
in our Docker Compose stack.

Assisted-by: AI-agent
```

### Breaking change

```
feat(api)!: rename CreateUser response fields to camelCase

All response fields are now camelCase to match the rest of the API.
Clients relying on snake_case fields must update their deserializers.

BREAKING CHANGE: response field names changed from snake_case to camelCase.
Closes #210
Assisted-by: AI-agent
```

### CI/build

```
ci(github-actions): add dotnet format check to PR workflow

Assisted-by: AI-agent
```

### Revert

```
revert: feat(cache): add Redis layer for session storage

Reverts commit a3f9c21. Redis introduces an additional infrastructure
dependency that was not approved for this environment.

Assisted-by: AI-agent
```

## Quality Checklist

Before outputting the commit message, verify:

- [ ] Header is ≤ 72 characters
- [ ] Type is from the allowed list and lowercase
- [ ] Summary is imperative mood, lowercase, no trailing period
- [ ] Body (if present) is **max 3 lines**, covering only the main points
- [ ] Body (if present) is separated from header by a blank line
- [ ] Footers (if present) are separated from body by a blank line
- [ ] `Assisted-by: AI-agent` is the absolute last line
- [ ] No "." at the end of the summary line
- [ ] No emoji unless the user explicitly requested them
