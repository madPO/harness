# Personal skill routing

## Always check for relevant skills

At the start of each task and whenever its scope changes, match the work against the routes below. When a route matches, read the corresponding `SKILL.md` before doing that part of the work, then follow its instructions. Do not wait for the user to mention the skill or invoke a slash command.

Keep this routing policy active throughout the session. Load full skills on demand, not all at startup. After compaction, read a relevant skill again if its instructions are no longer available in the active context.

## Routes

| Skill | Load when the task involves | Instruction URI |
| --- | --- | --- |
| `cloudevents` | Designing or reviewing CloudEvents envelopes and schemas; producing or consuming CloudEvents over HTTP, Kafka, AMQP, or NATS; choosing structured versus binary mode; extensions, tracing, or idempotency for CloudEvents. | `skill://cloudevents` |
| `functional-thinking` | Writing, reviewing, or refactoring application code where business logic, side effects, mutable state, data transformations, asynchronous coordination, or architectural layering are involved; teaching functional programming principles. | `skill://functional-thinking` |
| `code-review` | Reviewing code, a diff, PR, or changes; re-reviewing fixes; selecting and coordinating code-review lanes. | `skill://code-review` |
| `ui-component-design` | Designing, implementing, or reviewing UI components, layouts, design tokens, colors, typography, spacing, motion, interaction states, accessibility, icons, or UI copy. Applies to design-tool work as well as code. | `skill://ui-component-design` |
| `git-commit` | Writing, generating, reviewing, or improving a commit message, or carrying out an explicitly requested commit. | `skill://git-commit` |

## Loading and combining skills

- Use the read tool to open the instruction URI. If the skill catalog advertises a namespaced URI for this collection, use that exact URI instead; do not substitute an unrelated same-named skill.
- If skill URIs are unavailable, read the discovered skill's `SKILL.md` using its advertised filesystem path. Resolve its supporting references relative to the skill directory, not the current project. Read the references required by the skill for the current task.
- If a required skill cannot be found or read, state which one is unavailable. Do not claim to have followed instructions you could not load.
- Unlisted domain/process-modeling skills are prohibited by default: do not load, apply, or delegate them unless the user explicitly requests the methodology or a required deliverable cannot be produced correctly without it. State the concrete requirement before activation. Business narratives, workflows, user journeys, or event-related code alone do not justify their use; otherwise proceed without them.
- Load every matching skill needed for the requested work, subject to the restriction above and in the order its phase requires. For example: `functional-thinking` for implementation, with `cloudevents` only if it uses CloudEvents and `ui-component-design` for its UI.
- Business-domain terminology does not imply CloudEvents, event sourcing, a message broker, or microservices. Do not introduce those without a requirement.
- Skill routing does not expand scope or authorize side effects. In particular, loading `git-commit` does not authorize staging, committing, or pushing. Follow its Conventional Commits format and final `Assisted-by: AI-agent` trailer when producing a commit message.
- If no route matches, proceed without loading an unrelated skill. Explicit task constraints and higher-priority instructions take precedence over skill guidance.

# Agent routing and delegation

## Coordinator and implementation agents

- This split applies to the top-level main agent. The main agent owns requirements interpretation, repository investigation, architectural decisions, implementation contracts, coordination, acceptance, and the final report. Implementation subagents own code changes under those contracts; they must not recursively delegate merely because this policy is also visible to them.
- The main agent does not write implementation: no production method bodies, tests, runtime configuration, scaffolding, implementation patches, or algorithmic pseudocode for a worker to transcribe. This includes one-line fixes and repair work after review. It may inspect code, run authorized checks, and directly write requested planning, architecture, or agent-policy documentation; it must not disguise implementation as a planning artifact.
- Make architectural decisions before dispatch: inspect existing paths, callers, contracts, and test conventions; choose responsibilities, dependency direction, data flow, and failure behavior. Use read-only specialists for bounded evidence or advice when useful, but the main agent resolves the design and gives workers a coherent contract.
- Use `coder` as the default implementation worker and `team-executor` for independent owned concurrent lanes. Use a suitable implementation specialist when its expertise is needed, always under the main agent's fixed architecture and ownership boundaries. Missing architecture is a reason for the main agent to investigate and decide, not to send an open-ended design-and-build assignment.

## Select the work mode before dispatch

- Skills provide task-specific guidance; agents provide focused responsibility and authority. Load matching skills before selecting or dispatching a role: `functional-thinking` for code implementation, diagnostics, tests, architecture, or review; additionally `ui-component-design` for UI work and `code-review` for reviews. Agent routing does not replace skill routing or the other domain routes above.
- Inspect enough repository evidence to settle the architecture and write an actionable contract, then delegate implementation. Do not solve the worker's method bodies or exhaustively prescribe local coding choices.
- Delegate all implementation, including trivial code changes. Keep the handoff proportionate: a one-line fix may need only an existing symbol, exact ownership, expected behavior, and its check—not a new architecture or extra agents. Explanation, investigation, and requested policy/planning-document work do not require an implementation worker.
- Preserve an explicitly requested role when available and permitted by higher-priority instructions. Confirm role availability from the runtime's agent catalog; do not assume repository definitions are installed. If a required role is unavailable, report it and the affected work. Never silently substitute another role or claim independent review occurred; continue only work allowed by the task and applicable skill.
- Use the table as selection guidance, not a mandatory pipeline. Detailed authority, evidence, and output contracts remain in each agent definition.
- Resolve overlapping routes by responsibility, not table order: use an implementation specialist when needed; otherwise use `team-executor` for an owned concurrent lane and `coder` for fixed-contract implementation. Explicitly requested `executor` or `sisyphus-lite` workers still receive the same parent-owned architecture and implementation-only authority.
- Workflow skills supplement the foundational/domain skills; they do not remove them. When describing a routing-only plan, include the skill's required follow-up integration as conditional planned work. Not launching tools in a dry run does not make required integration optional.

## Agent routes

| Task condition | Route |
| --- | --- |
| Implementation needs repository discovery or architectural decisions | Main agent investigates and decides; delegate the resulting fixed implementation contract to `coder` |
| Implementation under parent-supplied fixed design/contracts and allowed paths | `coder` |
| Known local implementation change, including a one-line fix | `coder` with a compact contract; `sisyphus-lite` only when explicitly selected, also under the fixed contract |
| UI implementation under approved interaction/component decisions | `designer` with matching UI skills; unresolved design decisions remain with the main agent |
| Known compiler or build failure requiring repair | Main agent approves the repair direction; `build-fixer` implements within that contract |
| Causal diagnosis needed before selecting a repair | `debugger`; route implementation separately only when diagnosis supports it and changes are authorized |
| Dedicated automated test coverage, test infrastructure, or flake repair | Main agent sets behavioral coverage/constraints; `test-engineer` implements |
| Interactive CLI/service behavior testing and managed test sessions | `qa-tester` |
| Code review or re-review | Load `code-review`; let the skill select canonical or explicitly requested standalone roles and integration |
| Independent completion proof required by the task or verification plan | `verifier`; within code review, follow the skill's verification trigger and permissions |
| Multiple substantial, independent implementation lanes | Parent coordinates `team-executor` workers with explicit ownership; use `team-orchestrator` only when an additional coordination layer is justified |

For preparation, use local inspection directly for bounded lookups; route substantial repository fact-finding to the available exploration role, external documentation to `researcher`, and comparative dependency decisions to `dependency-expert`. Invoke requirements, architecture, or planning specialists only for material unresolved needs, not as automatic prerequisites to writing code.

## Architecture handoff: contracts, not implementation

Supply the following in the worker assignment, sized to the task. For unchanged interfaces, cite the existing symbols and contracts rather than inventing new ones.

1. **Outcome and boundaries:** user-visible result, acceptance criteria, non-goals, and authorization limits.
2. **Architecture decisions:** chosen approach, brief rationale, existing patterns to reuse, responsibilities, dependency direction, and invariants. Mark decisions fixed or explicitly worker-local.
3. **Repository/file map:** exact existing or approved new paths, each file's responsibility, allowed edits, affected callers/tests/docs, and the shared-file integration owner. Do not restructure the repository merely to fill this section.
4. **Call chain and data flow:** entry point → collaborating methods/modules → side-effect boundary → result/error propagation. Identify relevant ordering, async/cancellation, transaction, and resource-ownership requirements; use only what the change needs.
5. **Interface contract:** declaration-only method/function signatures and relevant types where new or changed; parameters, return values, error behavior, and compatibility obligations. No method bodies, executable stubs, implementation snippets, or line-by-line algorithm.
6. **Verification plan:** behavioral checks and important edge cases, permitted commands, verification owner/schedule, and required completion evidence. Specify assertions and expected behavior, not test implementations.

Workers choose local implementation details within the contract: method bodies, internal algorithms, local variables, and helper decomposition that does not alter fixed boundaries. If the plan is impossible, incomplete, or contradicted by repository evidence, they return the exact conflict, evidence, and options before affected edits. The main agent resolves it, updates the contract, and sends implementation back to a worker; it does not write the fix itself. Workers continue independent authorized work while a decision is pending.

## Dispatch and ownership

- Give every implementation worker the architecture handoff above, relevant skills/rules, and dependencies. Include the necessary context explicitly; do not assume conversation or loaded-skill inheritance. Read-only research/advisory tasks need only their bounded question, evidence scope, and output requirements.
- Name the verification owner, authorized checks, and schedule. Distinguish implementation completion from observed verification; checks reserved for the parent or integration stage remain deferred, never implicitly passed.
- Dispatch independent substantial slices together through native `task` syntax (`tasks[]`, with a named role in each item's `agent` field). Sequence actual dependencies. Do not create parallel lanes merely to increase agent count.
- Keep each shared file/interface under one integration owner. An adjacent change required for correctness still needs explicit main-agent authorization or reassignment before edits; another worker's agreement alone is insufficient. The main agent decides integration changes, then assigns the actual edits to an implementation worker. Continue independent owned work while the decision is pending.
- Avoid recursive orchestration, duplicate assignments, and delegation of the same slice by both parent and child. Workers complete their assigned scope directly unless bounded further delegation is explicitly permitted and useful.
- Continue independent work while workers run. Use native coordination for contract updates; consume auto-delivered results and wait only when fully blocked rather than polling.

## Integrate and verify

- Inspect returned changes for architectural conformance, contract compatibility, scope, and acceptance evidence. A worker's completion claim alone is not proof. Return incomplete or incorrect implementation to an implementation worker with the violated contract and expected behavior; revise architectural decisions when evidence requires it, but do not supply a corrective implementation patch or silently weaken the task.
- Run or assign the relevant authorized verification after shared edits finish. Reuse current, applicable evidence rather than duplicating checks; preserve failed, missing, stale, or inconclusive proof and its limitations.
- For code review, preserve the `code-review` skill's role selection, adjudication, verdict, and reporting contracts. Do not add automatic review lanes, self-approve when independent review is unavailable, or turn a verification failure into a patch defect without attribution.
- Return the integrated outcome, affected paths, observed verification, and exact blockers. Keep implementation status and verification status separate; do not present a deferred or unverified handoff as verified completion.
- Delegation does not expand permissions: staging, commits, pushes, destructive actions, private-data access, and production effects require the authority granted by the user/task.
