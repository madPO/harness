# JavaScript review extension for Herdr App

## 1. Goal and constraints

Build a native Herdr App mod for reviewing an agent's uncommitted changes and submitting collected inline comments.

The target environment is a Windows GUI connected to herdr-core in WSL or remote Linux.

The extension must use JavaScript and Herdr's existing runtime APIs. Git remains a backend prerequisite.

Do not require Hunk, Annotator, Node.js, Python, a compiled helper, or a separate network service at runtime.

This document specifies implementation work. No extension implementation or Windows runtime verification has occurred.

### Required workflow

1. Open the existing T3 Changes page for an agent's workspace.
2. View staged, unstaged, and untracked changes.
3. Select a line or contiguous range on either diff side.
4. Save comments across multiple files.
5. Edit or delete comments before sending.
6. Click **Send review** to submit all eligible comments as one message.
7. Observe submission status and confirm the message in the original agent's chat.

Comments and unfinished drafts must survive navigation and app restarts.

### Non-goals

- Branch comparisons, commit history, pull requests, and GitHub threads.
- AI-generated file ordering or automatic code reviews.
- Automatic sending, automatic retries, telemetry, or self-updating.
- Git mutation commands, editing repository files, or resolving merge conflicts.
- A terminal UI or browser-based replacement for the native GUI.
- Native Windows repositories in this delivery; the requested backends are WSL and Linux.

## 2. Evidence and unresolved compatibility

### Confirmed repository patterns

| Concern | Existing evidence | Reuse decision |
| --- | --- | --- |
| Native JavaScript views | `herdr/mods/git-graph/graph.js` imports `gpui-kit`, `gpui-base`, and `herdr` | Use the same native runtime |
| Machine-aware execution | `graph.js` and `execute.js` call `exec(program, argv, { cwd, on })` | Run Git through Herdr on the checkout's machine |
| Persisted mod preferences | `herdr/mods/t3-actions/store.js` uses `localStorage` | Use mod-local storage, subject to runtime verification |
| Changes integration | `herdr/layouts/herdr-t3.json` contains block ID `changes`, currently loading `annotator` | Replace its content without renaming the block |
| Changes navigation | `herdr/mods/git-graph/act.js` selects `panel-body` / `changes` | Preserve existing navigation commands |
| Test tooling | Root `package.json` provides `bun test` | Test pure JavaScript modules with existing development tooling |

Repository examples establish patterns, not proof that every API works in the installed Windows app.

The user has already confirmed Annotator fails on Windows and Reviewr does not satisfy the GUI requirement.

### Compatibility gate

Before building the complete UI, establish these capabilities in the actual Windows GUI:

1. Resolve the active source terminal, agent address, machine identity, and checkout path.
2. Execute Git through Herdr against both WSL and remote Linux checkouts.
3. Read untracked text files through a machine-aware API without a helper runtime.
4. Persist and restore mod data after restarting Herdr App.
5. Submit one explicit diagnostic message to the selected agent through a supported Herdr interface.
6. Distinguish successful submission from failure or an unknown delivery outcome.

Record the installed App/Core versions, supported API signatures, and observed results.

Agent submission is the principal unresolved dependency. `run(...)` existing in the runtime does not establish a message-submission command.

Inspect the installed Herdr API documentation and source before selecting that command.

Prefer a supported native message API. An existing `hc` command is acceptable only if Windows exposes it reliably.

Do not assume `hc`, POSIX shell utilities, Node built-ins, browser APIs, or direct SSH are available inside the mod.

Never substitute clipboard copying or an input-only paste for actual message submission.

If Herdr lacks a required capability, document the exact API gap before changing scope or adding dependencies.

## 3. Architecture

Use one native mod named `workspace-review` under `herdr/mods/workspace-review/`.

This name avoids collision with existing `mod:review` key bindings.

### Responsibilities and dependency direction

- **View:** render the file list, unified diff, comments, and send controls.
- **Controller:** coordinate refresh, navigation, storage, and explicit submission.
- **Pure model:** parse Git output, map line selections, validate anchors, and format review messages.
- **Herdr adapters:** resolve context, execute backend reads, persist data, and deliver messages.

The controller depends on pure calculations and narrow adapters. Pure modules must not import `herdr` or native UI packages.

Do not create a general plugin framework or share mutable state across unrelated mods.

### Data flow

1. Resolve source context from the focused agent terminal and its workspace.
2. Pin the context to the active review.
3. Read repository status and the selected file's diff on that machine.
4. Convert output into immutable file and diff records.
5. Save comments against the displayed snapshot.
6. Revalidate the snapshot and recipient before submission.
7. Persist a sending record before crossing the delivery boundary.
8. Submit one formatted message and persist the observed outcome.

Windows renders the interface and stores comments. Linux reads repository content and hosts the target agent.

Never translate Linux checkout paths into Windows paths.

### Planned file map

| Path | Responsibility |
| --- | --- |
| `herdr/mods/workspace-review/mod.json` | Native mod metadata following existing conventions |
| `herdr/mods/workspace-review/main.js` | View lifecycle, native controls, and event handling |
| `herdr/mods/workspace-review/controller.js` | Review orchestration and asynchronous operation ownership |
| `herdr/mods/workspace-review/context.js` | Workspace, machine, repository, and recipient resolution |
| `herdr/mods/workspace-review/git.js` | Read-only Git operations and backend file reads |
| `herdr/mods/workspace-review/diff.js` | Pure status/diff parsing and old/new line mapping |
| `herdr/mods/workspace-review/review.js` | Pure comment eligibility and message formatting |
| `herdr/mods/workspace-review/store.js` | Versioned persistence and recovery |
| `herdr/mods/workspace-review/delivery.js` | Verified Herdr submission adapter |
| `tests/herdr-review.test.ts` | Consumer-visible parsing, anchoring, isolation, and delivery-state regressions |
| `herdr/layouts/herdr-t3.json` | Replace Annotator in the existing Changes block |
| `herdr/keys.json` | Add Windows-compatible mod controls without overwriting unrelated bindings |
| `README.md` | Replace Annotator setup with dependencies, installation, permissions, and usage |

Keep adjacent imported T3 and Git Graph modules unchanged unless integration evidence requires an explicit adjustment.

One integration owner controls layout, key bindings, and root documentation.

## 4. Review context and persisted records

### Context identity

A checkout identity contains the Herdr machine identity and canonical repository root returned by backend Git.

A review identity additionally contains the source agent/session identity.

Store these as structured fields. Do not build ambiguous keys by concatenating paths with punctuation.

Never lowercase Linux paths or infer a machine from a display label.

Persist at least:

- Storage schema version and stable review ID.
- Machine identity, repository root, source terminal, and agent/session identity.
- Current file, unfinished drafts, comments, and send batches.
- Snapshot metadata needed to recognize changed context.

Treat terminal addresses as potentially reusable. Revalidate session identity before delivering a restored review.

### Comment record

Each comment contains:

- Stable ID, text, creation time, and modification time.
- Repository-relative path and diff side: old or new.
- Inclusive start and end line numbers.
- Selected source text and bounded surrounding context.
- Snapshot identity and attachment state: current or outdated.
- Delivery state and associated batch ID, when applicable.

Store draft text separately from saved comments. Never silently include unfinished drafts in a send.

### Persistence behavior

Use versioned `localStorage` records after confirming Windows support and practical size limits.

Persist saved comments immediately. Persist drafts on changes and flush before controlled navigation.

Serialize updates through the controller to avoid competing read-modify-write operations.

Use one mounted review instance initially. If duplicate mounting is possible, detect it before allowing concurrent writes.

Validate restored records. Preserve corrupt or unsupported-version data for export instead of silently overwriting it.

If storage fails, preserve in-memory text, show the failure, and block sending until batch state can be persisted.

Store only required snippets, not complete repository snapshots. Provide explicit review deletion and plain-text export.

## 5. Repository reads and diff semantics

### Uncommitted means all work since HEAD

The main view shows the net checkout difference from HEAD, plus untracked files.

Include staged-only changes, unstaged changes, and files changed in both places.

Do not concatenate staged and unstaged patches: that produces duplicate or contradictory line references.

For an unborn repository, compare against the empty baseline without assuming a SHA-1 object ID.

Read status using NUL-delimited output. Preserve paths containing spaces, Unicode, tabs, and newlines.

Pass commands as program/argument arrays. Pass repository paths after `--` where supported.

Use machine-aware file reads for untracked files. Verify the API and its encoding behavior during the compatibility gate.

Disable external diff and text-conversion helpers where supported. Suppress optional Git index refreshes using existing read conventions.

Repository reads must not stage, reset, checkout, commit, fetch, or write review metadata into the worktree.

### File handling

- Modified and added text files: display unified hunks with old/new line numbers.
- Deleted text files: allow comments against old-side lines.
- Renames: initially show deletion/addition without heuristic pairing.
- Untracked text files: display as new-side additions.
- Binary files, symlinks, and submodules: show an explicit summary without misleading line comments.
- Unmerged paths: show a conflict warning and block line commenting until the conflict is resolved.
- Empty files and mode-only changes: show a clear summary without fabricated lines.
- Preserve no-final-newline markers and CRLF content semantics.

Do not follow untracked symlinks outside the checkout.

### Snapshot consistency and limits

Git provides no atomic snapshot across status, diff, and independent file reads.

Detect changes during collection and request a refresh instead of presenting mixed data as authoritative.

Associate each asynchronous result with its originating context and refresh generation. Discard obsolete results.

Load file metadata first, then the selected file's patch. Use a virtual list for diff rows.

Start with a 1 MiB or 10,000-row limit per displayed patch, whichever arrives first.

These are initial design limits, not claims about measured runtime capacity.

Detect transport truncation and reject incomplete patches. If Herdr cannot bound transport output, record that limitation explicitly.

Show oversize files clearly. Never send excerpts based on an incomplete or malformed patch.

## 6. Native interface and interaction

Use the existing Changes page, with a file list, unified diff, comment editor, and review summary.

Show the pinned machine, checkout, and recipient near the header.

Opening the page captures the source context. Focusing the mod must not erase that source association.

Switching workspaces opens that workspace's saved review. Returning restores previous comments and drafts.

Provide an explicit context-switch action if the source agent changes inside the same workspace.

### Controls

- Click a source line to select it; Shift-click extends the range on the same side.
- Provide keyboard navigation and range selection without requiring mouse input.
- Save, edit, and delete comments with explicit controls.
- Show outdated comments separately and explain why sending is blocked.
- Show recipient, eligible comment count, and a message preview before submission.
- Use one explicit **Send review** action in that preview.

Use Ctrl-based Windows shortcuts after checking existing bindings. Saving a comment must never also submit a review.

Use current Herdr theme tokens and existing T3 spacing conventions.

Distinguish additions and deletions with signs and labels, not color alone.

Implement visible focus, selected, disabled, loading, and error states. Explain blocked actions next to their controls.

Render repository content and comments as literal text. Do not interpret them as executable markup or commands.

## 7. Anchoring and stale comments

Initially use conservative snapshot anchoring, not automatic fuzzy relocation.

A comment remains current only when its displayed file patch and source anchor still match the saved snapshot.

Changes in unrelated files must not invalidate every comment.

A changed file patch marks its comments outdated, even when some selected lines appear unchanged.

This conservative rule avoids attaching feedback to the wrong occurrence of repeated code.

Keep outdated comments visible. Let the user select a new anchor and explicitly reconfirm the comment.

Before sending, refresh relevant files and validate every selected comment again.

Never silently drop outdated comments and claim the whole review was sent. Require explicit resolution or exclusion in the preview.

## 8. Submission contract and failure behavior

The delivery adapter must submit to the pinned agent, not whichever terminal happens to be focused.

Recheck the machine, checkout, session identity, and readiness immediately before submission.

If several agents share a checkout, require an explicit recipient. Never choose the first agent from a list.

Initially permit idle or completed agents only. Block working agents until supported queue semantics are verified and deliberately enabled.

Never bypass permission prompts or send arbitrary terminal keystrokes into an unknown prompt.

### Message contents

Each batch contains a stable batch ID, checkout identity, and ordered comments.

Each comment includes its relative path, side, line range, selected excerpt, and user text.

Use stable file/line ordering and literal text formatting. Do not add unrequested instructions about testing or implementation strategy.

Never silently truncate a review. Discover transport limits during the compatibility gate and block oversized messages with an actionable explanation.

### Delivery states

| State | Meaning | Allowed action |
| --- | --- | --- |
| Draft | Saved feedback has not crossed the submission boundary | Edit, delete, or send |
| Sending | The persisted batch is immutable and submission is in progress | Wait; disable duplicate sends |
| Submitted | The transport acknowledged submission to the intended session | Retain history; hide from pending comments |
| Failed | The transport establishes that submission did not occur | Preserve comments; allow explicit retry |
| Uncertain | Submission may have occurred, but confirmation is unavailable | Preserve batch; require checking chat before another send |

A restart with a persisted Sending batch becomes Uncertain.

Transport acknowledgment proves submission, not agent execution or completion.

Exactly-once delivery cannot be promised without transport-supported deduplication.

Never automatically retry an uncertain submission. An explicit resend retains the original batch identity for inspection.

## 9. Implementation sequence and ownership

### Phase 1: Verify runtime capabilities

1. Inspect the installed Herdr App/Core APIs and record their versions.
2. Exercise context resolution and backend reads in Windows against WSL.
3. Repeat against remote Linux.
4. Verify persistent mod storage across restart.
5. Send one user-approved diagnostic message to a designated agent on each backend.
6. Record submission acknowledgment and disconnect behavior.

Exit criterion: every required capability has observed evidence or an exact blocking API gap.

Do not build the full UI around an invented delivery API.

### Phase 2: Implement the read-only review path

1. Implement context identity and machine-routed reads.
2. Implement status/diff parsing and unified line mapping.
3. Render the file list and selected file's diff.
4. Handle unsupported files, empty repositories, errors, and stale asynchronous results.
5. Exercise the actual GUI against disposable repositories on both backends.

Exit criterion: displayed paths and line numbers match repository content without mutating the checkout.

### Phase 3: Implement comments and persistence

1. Implement line/range selection and comment editing.
2. Persist saved comments, unfinished drafts, and review context.
3. Implement conservative stale-anchor detection and explicit reattachment.
4. Exercise workspace switching and app restart recovery.

Exit criterion: comments remain correctly isolated, recoverable, and attached to their reviewed source.

### Phase 4: Implement batch submission

1. Implement deterministic message formatting and the recipient preview.
2. Implement persisted delivery states and readiness checks.
3. Connect the verified Herdr submission interface.
4. Exercise successful delivery, definite failures, uncertain outcomes, and repeated clicks.

Exit criterion: one action submits one complete review to the original agent without silent loss or rerouting.

### Phase 5: Integrate and document

1. Replace the layout's Annotator content with `workspace-review`, preserving block ID `changes`.
2. Add only necessary Windows-compatible bindings.
3. Replace Annotator installation and usage instructions in `README.md`.
4. Document dependencies, permissions, data retention, limits, installation, updates, and rollback.
5. Verify Git Graph and T3 still open the Changes page.

Do not uninstall or delete the user's separate Annotator installation or its saved data.

### Work assignment

The main agent owns architecture, API decisions, integration acceptance, and verification evidence.

Delegate implementation to a coder under the fixed responsibilities and file boundaries above.

Use one implementation owner initially. Split independent pure-model and GUI work only after confirming shared contracts.

Reserve test/build runs for integration checkpoints after owned edits finish, rather than running conflicting checks mid-edit.

## 10. Verification strategy

### Automated behavioral coverage

Use existing Bun development tooling. Do not add a runtime package manager requirement.

Keep native Herdr imports outside pure modules so tests can import calculations directly.

Cover plausible consumer-visible failures:

- Staged-only, unstaged-only, combined, untracked, deleted, and unborn-repository changes.
- Old/new line mapping across multiple hunks, CRLF, and missing final newlines.
- Unusual paths, malformed patches, binary changes, conflicts, and oversize files.
- Review isolation between identical paths on different machines and between different agent sessions.
- Context switching while remote reads are in flight.
- Draft restoration and storage failures without silent data loss.
- Outdated anchor detection without invalidation from unrelated files.
- Batch inclusion, stable ordering, wrong-recipient blocking, duplicate-click prevention, and uncertain delivery recovery.

Assert resulting behavior and state transitions. Do not test copied implementation text or mock echoes as proof of delivery.

Run the targeted review tests after implementation, then the existing repository suite.

Run the existing typecheck only where applicable; runtime JavaScript API compatibility still requires the actual App.

### Required Windows GUI smoke runs

Repeat the following against both WSL and remote Linux:

1. Open a disposable repository containing staged, unstaged, untracked, and deleted text files.
2. Open Changes from the intended agent's workspace.
3. Verify the machine, root, recipient, diff content, and line numbers.
4. Save comments across two files, including an old-side deleted line.
5. Switch workspaces and return; verify comments remain isolated.
6. Restart the App; verify comments and unfinished drafts return.
7. Modify a reviewed file; verify stale comments cannot be sent silently.
8. Reattach or explicitly exclude stale comments in the preview.
9. Send a review to an idle designated agent.
10. Observe one complete message in that exact agent's chat.
11. Verify repeated clicks do not create duplicate submissions.
12. Disconnect during submission; verify uncertain outcomes remain visible and never retry automatically.
13. Open Changes through existing T3 and Git Graph controls.
14. Exercise keyboard controls and readable focus/error states in light and dark themes.

Capture installed versions, backend identity, commands, observed chat output, and screenshots without secrets or private source.

Automated tests do not replace these GUI checks. If Windows is unavailable, report verification as incomplete.

### Completion criteria

The extension is complete only when the required workflow works through the Windows GUI on both requested backend types.

All affected layout bindings, user instructions, and consumer-visible tests must match the final behavior.

Keep implementation completion separate from observed runtime verification.

## 11. Installation and rollback requirements

Document the Windows App's actual configuration directory after verifying it. Do not assume WSL's home is the App's home.

Install the JavaScript mod into the Windows App's mods directory using real file copies.

Back up the existing layout and reconcile customizations before replacing its Changes content.

Do not copy the mod into backend plugin directories or require backend extension installation.

Backends need only Herdr Core, Git, and the existing agent session, provided the compatibility gate confirms all required APIs.

Keep review storage independent from repository files and Annotator's private storage format.

Rollback restores the previous Changes content and removes only this mod's explicit bindings.

Retain review data unless the user explicitly deletes it.

## 12. References

- Local layout: `herdr/layouts/herdr-t3.json`.
- Native view and machine routing: `herdr/mods/git-graph/graph.js`.
- Read-only command conventions: `herdr/mods/git-graph/git.js`.
- Program/argv execution contract: `herdr/mods/git-graph/execute.js`.
- Existing Changes navigation: `herdr/mods/git-graph/act.js`.
- Existing storage conventions: `herdr/mods/t3-actions/store.js`.
- Current installation documentation: `README.md`, Herdr section.
- Upstream Annotator reference: https://github.com/jakub-tucek/herdr-annotator.

Treat upstream Annotator as a behavioral reference, not a Windows compatibility guarantee.

Prefer an independent implementation. Preserve licenses and attribution if any upstream code is reused.
