# Personal skill routing

## Always check for relevant skills

At the start of each task and whenever its scope changes, match the work against the routes below. When a route matches, read the corresponding `SKILL.md` before doing that part of the work, then follow its instructions. Do not wait for the user to mention the skill or invoke a slash command.

Keep this routing policy active throughout the session. Load full skills on demand, not all at startup. After compaction, read a relevant skill again if its instructions are no longer available in the active context.

## Routes

| Skill | Load when the task involves | Instruction URI |
| --- | --- | --- |
| `event-storming` | Turning business narratives, application workflows, or user journeys into use-cases and a domain/process model; identifying events, commands, actors, policies, aggregates, read models, external systems, or hotspots. | `skill://event-storming` |
| `cloudevents` | Designing or reviewing CloudEvents envelopes and schemas; producing or consuming CloudEvents over HTTP, Kafka, AMQP, or NATS; choosing structured versus binary mode; extensions, tracing, or idempotency for CloudEvents. | `skill://cloudevents` |
| `functional-thinking` | Writing, reviewing, or refactoring application code where business logic, side effects, mutable state, data transformations, asynchronous coordination, or architectural layering are involved; teaching functional programming principles. | `skill://functional-thinking` |
| `ui-component-design` | Designing, implementing, or reviewing UI components, layouts, design tokens, colors, typography, spacing, motion, interaction states, accessibility, icons, or UI copy. Applies to design-tool work as well as code. | `skill://ui-component-design` |
| `git-commit` | Writing, generating, reviewing, or improving a commit message, or carrying out an explicitly requested commit. | `skill://git-commit` |

## Loading and combining skills

- Use the read tool to open the instruction URI. If the skill catalog advertises a namespaced URI for this collection, use that exact URI instead; do not substitute an unrelated same-named skill.
- If skill URIs are unavailable, read the discovered skill's `SKILL.md` using its advertised filesystem path. Resolve its supporting references relative to the skill directory, not the current project. Read the references required by the skill for the current task.
- If a required skill cannot be found or read, state which one is unavailable. Do not claim to have followed instructions you could not load.
- Load every matching skill needed for the requested work, in the order its phase requires. For example: `event-storming` for business modeling, then `functional-thinking` for requested implementation, with `cloudevents` only if that implementation uses CloudEvents and `ui-component-design` for its UI.
- EventStorming business events do not imply CloudEvents, event sourcing, a message broker, or microservices. Do not introduce those merely because the modeling skill applies.
- Skill routing does not expand scope or authorize side effects. In particular, loading `git-commit` does not authorize staging, committing, or pushing. Follow its Conventional Commits format and final `Assisted-by: AI-agent` trailer when producing a commit message.
- If no route matches, proceed without loading an unrelated skill. Explicit task constraints and higher-priority instructions take precedence over skill guidance.
