---
name: event-storming
description: Extract Spec Kit–style use-cases from the user's input, then derive one or more business processes modeled with EventStorming from those use-cases. Use when asked to decompose application workflows, user journeys, or business narratives into events, commands, actors, policies, aggregates, read models, external systems, and hotspots. Produce prioritized user journeys with independently testable acceptance scenarios and a traceable textual model with explicit causal links, process boundaries, alternative outcomes, and unresolved questions; not implementation code or a deployment architecture.
metadata:
  author: madPO <social@madpo.me>
  version: '1.3'
---

# EventStorming from application narratives

## Goal and scope

Given a description of how people work with an application, first extract use-cases in the user-story structure of [GitHub Spec Kit's specification template](https://github.com/github/spec-kit/blob/main/templates/spec-template.md), then derive an understandable, traceable EventStorming model from them. Model business intentions, facts, decisions, and reactions, rather than a sequence of UI clicks or technical function calls.

Use the user's language and domain vocabulary. Preserve business distinctions; do not rename domain concepts merely to fit a familiar example. No repository inspection, coding, or external research is needed unless the user explicitly requests it or supplies source material to consult.

Deliver the use-cases followed by the model, not just instructions on how to create them. Start with the information available, extract provisional use-cases before modeling blocks, then use interactive hotspot questions to resolve material business choices before final delivery. Update both layers with the answers. Do not stop at a passive list of questions when interactive clarification is available. Ask only about decisions the user must make, not facts already available in the supplied material.

Aggregate discovery is a required result, not an optional enrichment. Every local state-changing command must have a confirmed aggregate, an explicitly labeled candidate aggregate, or an ownership hotspot explaining why no defensible candidate can be named. Missing rules normally lead to a candidate with open questions, not silent omission. Read-only journeys and external-only work do not require local aggregates.

## Evidence discipline

- Treat the narrative and supplied clarifications as the source of truth.
- Separate **stated behavior** from **inferred modeling choices**. Label inferred process boundaries, decision owners, and other material assumptions where they appear.
- Do not invent payment, approval, notification, retry, timeout, cancellation, or error-handling behavior because it is common in similar applications.
- An unknown outcome is a hotspot, not a fictional event or branch. A proposed extension belongs in a separately labeled proposal only if requested.
- Do not infer event sourcing, message brokers, microservices, transactions across systems, or asynchronous execution from EventStorming notation.
- Never silently choose between contradictory statements. Show the contradiction and its affected blocks.

## Blocks and identification rules

Colors are common workshop conventions, not required syntax. Always include textual block types; color must not carry meaning alone.

| Block | Meaning | Identification question | Naming |
| --- | --- | --- | --- |
| Domain event (orange) | A business-relevant fact that has happened | What changed or became true that matters to the business? | Past tense: `Application Submitted`, `Booking Cancelled` |
| Command (blue) | An intention or request to perform an action; success is not guaranteed | What action was requested to cause this event? | Imperative: `Submit Application`, `Cancel Booking` |
| Actor (small yellow note) | A person or role deciding to issue a command | Who makes this decision? | Role: `Applicant`, `Reviewer` |
| Policy (lilac) | A business reaction to an event that initiates further action | When this fact occurs, under what condition should which action follow? | `When <event>, if <condition>, issue <command>` |
| Aggregate (pale yellow) | A business decision and consistency boundary that owns state and protects invariants | What owns this decision, and what must remain consistent when the command is handled? | Domain noun: `Application`, `Booking` |
| Read model (green) | Information used by an actor to make a decision | What must the actor see before issuing this command? | `Review Queue`, `Booking Details` |
| External system (pink) | A dependency outside the modeled responsibility | What work or result comes from a system outside this scope? | Supplied system or role name |
| Hotspot (red) | An unresolved rule, risk, ambiguity, or disagreement | What is unknown, conflicting, or insufficiently specified? | A precise question tied to a process or block |

### Distinctions to preserve

- **Event versus command:** `Approve Application` is an intention; `Application Approved` is a fact. Do not equate command issuance with success.
- **Business event versus interaction:** opening a tab, clicking a button, or loading a page is ordinarily interaction context. Include it as a domain event only if the narrative gives it business significance, such as an acknowledgement or auditable access.
- **Policy versus human decision:** an automatic business reaction is a policy. A reviewer deciding after reading information is an actor issuing a command, not an automatic policy. A policy may request human work without deciding its outcome.
- **Aggregate versus entity:** a business entity has identity and continuity; an aggregate is a decision and consistency boundary containing a root entity and, where supported, other entities and value objects. Its root controls changes within that boundary. A noun, table, screen, actor, or service is not automatically an aggregate. Confirm a boundary only with evidence of state ownership and an invariant; otherwise expose a candidate with an explicit assumption and ownership hotspot. Aggregate discovery does not prescribe behavior-heavy classes, storage layout, or a one-to-one mapping to implementation entities.
- **Read model versus command:** viewing or filtering information does not necessarily change business state. Represent the information and interaction without manufacturing a state-changing command/event pair.
- **External system versus aggregate:** an external provider is not a local aggregate. Show the request crossing the scope boundary and the reported result; include a local decision owner only when supported.
- **Event handler:** model its business role as a policy if it requests further action, or as a read-model update if it changes decision-support information. Do not add technical handler classes to the business model.
- **Unit:** clarify through responsibility. It may mean an aggregate, an organizational actor, an external system, or a larger responsibility boundary; never map the word mechanically to an aggregate.

## Workflow

### 1. Extract evidence and use-cases

Identify the described roles, intentions, state changes, rules, information needs, external interactions, and outcomes. Retain short source phrases for the blocks so the reader can trace them back to the narrative.

Separate screen navigation from business behavior. Navigation may explain where an actor sees a read model or issues a command, but does not determine process boundaries.

Before naming EventStorming blocks or choosing process boundaries, turn the evidence into goal-oriented use-cases using Spec Kit's **User Scenarios & Testing** structure. This is a business-analysis adaptation of its user stories, not a request to generate a complete Spec Kit feature specification, branch metadata, implementation plan, or tasks.

For each use-case:
1. Assign a stable ID such as `UC1` and a short user-story title. Describe the actor, goal, and value in plain language; retain a source phrase or clarification reference.
2. Assign importance with Spec Kit's `P1`, `P2`, `P3`, etc. and explain **Why this priority**. Use supplied priorities when present; otherwise explicitly label a proposed ranking as inferred and give its rationale. If no defensible ranking is available, use **Unspecified** rather than inventing importance. Priority is not causal order; `UC1` is an ID, not a ranking. Process IDs such as `P1` are a separate namespace.
3. Describe an **Independent Test**: the business action, observable result, and value that demonstrate this journey independently. Use supplied preconditions or existing artifacts; do not invent setup workflows or claim independence where another use-case is a prerequisite. Name any such dependency.
4. Record **Acceptance Scenarios** with stable IDs such as `UC1-AS1`, using **Given** (supported initial state), **When** (actor action or external trigger), **Then** (supported observable outcome). Include described alternatives, not hypothetical failures. Mark missing preconditions or outcomes as `[NEEDS CLARIFICATION: ...]` with a stable use-case hotspot ID such as `UC1-H1`; do not turn the unknown into a success criterion.
5. Collect described **Edge Cases** and genuinely unresolved boundary questions. A question is not an accepted scenario or a new requirement. Do not invent error handling, performance targets, or domain rules to fill the structure.

Group steps that deliver one user goal into a journey rather than creating a use-case for every click or command. Keep independent goals separate. A multi-actor journey may be one use-case when its actions serve one outcome. Preserve read-only and external-only use-cases. If the goal itself is unknown, retain a provisional use-case with an explicit goal hotspot.

These use-cases become the basis for every subsequent pass. Keep the original evidence available for rules and ownership details: restructuring it into scenarios must not discard or override it. Use-case completion may be information access or an external result, not necessarily a local domain event.

### 2. Establish process boundaries from use-cases

Derive processes from the extracted use-case goals, triggers, and acceptance scenarios. Use one process per coherent business goal with a recognizable trigger and outcome. Record the originating use-case and scenario IDs. Do not assume one use-case equals one process: explain any split or shared process and preserve the contributing scenario references.

Split when a segment has its own business goal and completion condition and can be meaningfully described separately. A separate initiating action, lifecycle, or responsibility is supporting evidence. Do not split solely because a screen, actor, aggregate, or technical service changes.

Keep alternative outcomes and short causal reactions inside the same process when they serve the same goal. A long narrative may still be one process; a short narrative may contain several independent goals.

For every process record:
- Business goal and name.
- Trigger and initiating role or source, if supplied.
- Successful outcome and described alternative outcomes.
- Scope boundary and related processes.
- Any material inference used to choose the boundary.

A read-only journey can be an information-access process: specify its actor, goal, read model, and completion condition. Explicitly state that no domain-state transition was described; do not invent events or aggregates to fill the template.

### 3. Build the event timeline

Extract business facts from the use-case acceptance outcomes and their source evidence, and order them by causality. Map stated Given conditions to context or rules, When actions to causes, and Then outcomes to business facts or information-access completion as appropriate; do not mechanically turn every Then into a domain event. Do not impose a total ordering where the narrative permits independent or parallel work.

Include rejection, failure, cancellation, and expiration events only when described. For an outcome that is not specified, attach a hotspot at the relevant command or decision.

If a described attempt has no confirmed result, preserve the request and leave the outcome unresolved instead of presenting success as fact.

### 4. Add causes and decisions

For each event identify, where supported:
1. The command or external occurrence that causes it.
2. The actor, policy, external source, or explicit scheduled trigger initiating it.
3. The decision owner and business rules.
4. Information used by a human decision-maker.

An external occurrence may start a process without a local command. A policy must identify its triggering event, any stated condition, and its outgoing command. Human decisions must retain the actor and read model rather than becoming an invented automatic reaction.

### 5. Discover aggregates and assign command ownership

Perform this pass even when the narrative does not name aggregates. Use business entities, use-case preconditions, and evidenced acceptance rules as starting points, not as a finished list of aggregates.

For each local state-changing command:
1. Identify the business object whose identity and lifecycle carry the affected state. For creation, consider the identity being created; do not invent a registry aggregate merely because the object does not exist yet.
2. Identify the state the decision needs and the changes it owns. Record stated preconditions and invariants: what must remain true when the change is accepted?
3. Propose the smallest cohesive boundary that owns that decision and protects those rules. Identify its root and internal entities/value objects only where supported; do not absorb every referenced entity into the boundary.
4. Classify the boundary as **confirmed** when ownership and a consistency rule are supported, or **candidate** when ownership, the rule, or membership remains inferred. An entity's name or a state-changing verb alone is not enough to confirm an aggregate.
5. Assign the command to that boundary and link its described resulting events. For a candidate, label the ownership link as inferred and attach precise hotspots for the missing rules. Do not invent an invariant to fill the output.

Reuse the same aggregate ID across processes when they operate on the same identity, state, and rules. Different processes or actors do not by themselves imply different aggregates. Likewise, a shared noun does not prove shared ownership.

When a rule spans candidate boundaries, record which state must remain consistent and who could own the decision as a hotspot. Do not silently merge the boundaries or assert atomic changes across them. A policy coordinates follow-up intentions; it is not automatically the owner of all participating state.

If even a candidate cannot be named from the narrative, retain the command with an explicit **unresolved owner** hotspot explaining what identity or state ownership is missing. External-only commands must instead identify their external system; read-only interactions must state that no local state change was described. These exceptions must be visible, not blank ownership fields.

### 6. Link processes and branches

Use stable local IDs such as `P1`, `P1-C1`, and `P1-E1`. Every flow reference must resolve to a declared block. When the same event connects processes, reference the original ID rather than duplicating it as two unrelated facts.

Trace each acceptance scenario to its process and relevant block IDs, or to explicit read-only interaction context. Trace blocks back to the originating use-case/scenario and source evidence. Supporting rules and blocks not expressed as standalone scenarios must still identify their originating use-case and evidence. Preserve many-to-many links; do not duplicate shared facts or aggregates to force a one-to-one mapping.

Label the relationship, not just an arrow:
- Actor **issues** command.
- Command **handled by** confirmed aggregate, or **provisionally handled by** candidate aggregate with the inference stated.
- Accepted handling **produces** event.
- Event **triggers** policy; policy **issues** command.
- Read model **informs** actor.
- Event **updates** read model, only when supported.
- Command **requests work from** external system; its response **reports** an event, when described.

Distinguish causality from mere sequence. At branches name the stated condition or resulting event. For parallel paths state whether a join is described; an unspecified join is a hotspot, not an invented synchronization rule.

### 7. Check use-case coverage

Before clarification, check that every use-case and acceptance scenario has a process mapping or a visible hotspot explaining why it cannot yet be modeled. Each process and business block must be justified by a use-case and original or clarified evidence, not invented to complete a diagram. Unknown Then outcomes remain hotspots; they cannot authorize events. Priorities affect presentation, not causality.

### 8. Resolve material hotspots interactively

Use the `ask` tool when available in interactive mode. First give a short provisional explanation of the affected use-case, process, or aggregate and what remains unknown; do not require the user to review a full model before answering. Resolve use-case goal or outcome questions before questions that depend on those answers. Use-case hotspots keep their `UC1-H1` IDs when referenced by the model.

**Choose and order questions**
- Ask about materially different business choices affecting goals, ownership, invariants, human versus automatic decisions, causal ordering, or outcomes. Do not survey cosmetic wording, technical implementation choices, or every unspecified detail.
- Reuse each hotspot's stable ID as the question ID and name the affected use-case, scenario, and block IDs as applicable. Split independent decisions into separate questions instead of bundling ownership, rules, and outcomes into one answer.
- Batch related independent questions in one `ask` call. Resolve prerequisite decisions first; generate dependent options only after their prerequisite is answered.
- Do not ask for facts already stated in the narrative or prior answers. Do not manufacture additional business scope just to produce a survey.

**Offer meaningful choices**
- Provide 2–5 distinct, plausible options per question, using short domain-language labels and a brief description of each option's business consequence or tradeoff.
- Options are hypotheses for the user to choose, not established rules or events. Ground them in the supplied domain and explain any inference. Do not present generic architecture alternatives as business choices.
- Recommend an option only when supplied rules or goals justify it; explain why in its description. Otherwise leave `recommended` unset. Never treat a recommendation or an unanswered question as consent.
- Use single selection for mutually exclusive decisions; set `multi: true` only when choices can legitimately coexist.
- The `ask` UI automatically adds **Other (type your own)**. Do not supply a duplicate Other option. Explicitly tell the user they may enter a custom answer; accept it even when it matches none of the suggestions.
- Where postponement is meaningful, include an option such as **Keep unresolved** with the consequence that the aggregate or branch remains provisional. A skipped or unanswered question likewise remains open.
- If `ask` is unavailable or the run is non-interactive, provide equivalent numbered questions with labeled options, consequences, and an invitation to enter a custom answer. Do not fabricate responses or claim an interactive survey occurred. An explicit request for no questions instead leaves hotspots open in the delivered model.

**Apply answers and converge**
- Treat selected choices and free-text answers as new source evidence. Record the answer against its hotspot ID and distinguish it from the original narrative and remaining inferences.
- Update every affected use-case, priority rationale, independent test, acceptance scenario, coverage link, catalog entry, flow, process boundary, aggregate inventory row, and alternative outcome. Preserve IDs when refining the same journey or scenario. Promote a candidate only when the answers actually establish the required ownership and invariant.
- If a custom answer resolves only part of a question, apply that part first, then ask only about the remaining material ambiguity. If it contradicts earlier evidence, ask whether it replaces that rule or describes a separate context; do not silently overwrite the conflict.
- Mark hotspots **resolved** only when their questions are answered, or **deferred** when the user chooses to postpone them. Keep unanswered hotspots **open**; deferred is not resolved. Preserve the status in every reference: a deferred question remains an unknown rule or outcome, but must not be labeled open elsewhere in the model.
- Repeat only for material questions newly exposed by answers. Do not re-ask resolved or deferred questions unless new conflicting evidence appears or the user explicitly revisits them. Stop when material hotspots are resolved or deferred, no material questions remain, or the user asks to finish; deliver the model with all remaining uncertainties visible.

### 9. Check the use-cases and model before delivery

- Every described business action and outcome is represented, or explicitly retained as interaction context.
- Use-cases precede the model and include a plain-language journey, priority with evidence or explicit inference, rationale, independent test, and Given/When/Then acceptance scenarios.
- Every use-case and scenario maps to process/block IDs or explicit read-only context; unknown goals and outcomes map to hotspots instead of fabricated behavior.
- Every process and block traces to the originating use-case and supplied evidence; priority has not been treated as temporal ordering.
- Process boundaries follow goals, not page or service boundaries.
- Events are facts and commands are intentions.
- Policies have a trigger and an outgoing action; no unexplained automation.
- Actors retain human decisions and their information needs.
- Every local state-changing command maps to a confirmed or candidate aggregate in both the catalog and flow, or has an explicit unresolved-owner hotspot.
- Confirmed aggregates have evidenced ownership and invariants; candidates state their ownership assumptions and missing rules without manufacturing either.
- Aggregate IDs are reused across related processes; referenced entities are not automatically internal members.
- External-only and read-only paths explicitly explain why no local aggregate applies.
- Alternative paths match the narrative; missing rules remain hotspots.
- IDs and cross-process links resolve, including handoffs.
- Inferences are visible and no implementation architecture has been asserted.
- Material hotspots have been offered through interactive questions when available, or the non-interactive/no-questions exception is stated.
- Answers are traceable to hotspot IDs and reflected consistently throughout the model; suggested but unselected options are not presented as facts.
- Open and deferred hotspots remain visible; resolved questions are not asked again.

## Required output

Scale detail to the input, but preserve these sections. Omit inapplicable fields rather than filling them with fabricated blocks.

### 1. Use-cases — User Scenarios & Testing

Follow Spec Kit's user-story structure, with stable use-case and acceptance-scenario IDs added for EventStorming traceability. Order by supported or explicitly inferred importance; when importance is unspecified, retain source order and say so.

#### UC1 — User Story 1 - <brief title> (Priority: P1 / inferred P1 / Unspecified)

<Plain-language journey: actor, goal, and business value.>

**Source evidence**: <short source phrase or clarification reference>

**Why this priority**: <stated reason, explicit inferred rationale, or insufficient evidence to rank>

**Independent Test**: <action and observable business value; supplied preconditions and any dependency>

**Acceptance Scenarios**:

1. **UC1-AS1**: **Given** <initial state>, **When** <action or trigger>, **Then** <observable outcome>.

Use `[NEEDS CLARIFICATION: ...; UC1-H1]` for an unsupported part rather than filling it with an assumption. Repeat for each use-case and its supported alternative scenarios.

#### Edge Cases

List supplied boundary cases and unresolved questions with their use-case/scenario and hotspot IDs. State when none are described; do not manufacture cases.

### 2. Process overview

| ID | Use-case / scenario IDs | Process / business goal | Trigger | Completion and alternative outcomes | Boundary rationale |
| --- | --- | --- | --- | --- | --- |
| P1 | UC1 / UC1-AS1 | ... | ... | ... | Stated or inferred rationale |

If there is only one process, say why its steps share one goal. If several, explain their handoffs or independence.

**Use-case coverage**

| Use-case / scenario ID | Process IDs | Relevant block IDs or interaction context | Unresolved hotspot IDs |
| --- | --- | --- | --- |
| UC1 / UC1-AS1 | P1 | P1-C1, P1-E1; or read-only context | None or stable hotspot IDs |

Include every acceptance scenario, including unresolved ones. Use multiple references for shared processes or handoffs. If a process cannot yet be identified, name the blocking hotspot instead of inventing one.

### 3. Model for each process

**P1 — <process name>**
- Originating use-case and scenario IDs: ...
- Scope and goal: ...
- Interaction context: ... (only when useful)

**Block catalog**

| ID | Type | Name | Responsibility / rule | Use-case / scenario IDs | Evidence or explicit inference |
| --- | --- | --- | --- | --- | --- |
| P1-A1 | Actor | ... | ... | UC1 / UC1-AS1 | Short source phrase |
| P1-C1 | Command | ... | ... | UC1 / UC1-AS1 | Short source phrase |
| P1-E1 | Domain event | ... | ... | UC1 / UC1-AS1 | Short source phrase |

Include confirmed and candidate aggregates discovered in step 5 in the block catalog; reference the same ID when an aggregate is reused. Include policies, read models, external systems, and hotspots as applicable. The responsibility column must capture a policy's trigger/condition/action and an aggregate's state ownership and supported invariant. For candidates, state the inferred ownership and unknown rule instead of repeating the name. Trace supporting rules to their use-case and evidence even when no individual scenario specifies them.

**Flow**

```text
P1-R1 [Read model: ...] --informs--> P1-A1 [Actor: ...]
P1-A1 --issues--> P1-C1 [Command: ...]
P1-C1 --handled by--> P1-G1 [Aggregate: ...]
P1-G1 --on accepted handling produces--> P1-E1 [Event: ...]
P1-E1 --triggers--> P1-POL1 [Policy: ...]
P1-POL1 --issues--> P1-C2 [Command: ...]
```

This is a syntax example, not mandatory content. Adapt it to actual evidence. Show supported branches and external interactions explicitly. For a candidate, use `[Candidate aggregate: ...]` and `--provisionally handled by (inferred)-->`. Only when no defensible candidate can be named may the command link directly to the described result; annotate that link with the unresolved-owner hotspot ID.

Mermaid is optional when requested or useful; a typed text flow is the default. Diagram labels and IDs must agree with the catalog.

### 4. Aggregate inventory and command ownership

Always include this section. Consolidate boundaries across all processes rather than producing a separate noun list.

| Aggregate ID / name | Status and evidence / assumption | Root and owned state | Internal entities / value objects | Commands → described events | Invariants and ownership hotspots |
| --- | --- | --- | --- | --- | --- |
| P1-G1 / ... | Confirmed or candidate; source phrase or explicit inference | Supported root/state, or explicitly unknown | Supported membership only; otherwise unspecified | Command IDs → event IDs; unknown outcomes remain open | Stated rules; hotspot IDs for missing rules or boundaries |

Use the same IDs as the block catalogs and flows. State explicitly when internal membership is unspecified; a reference to another entity does not establish containment. Inventory entries must explain responsibility, not just name business entities.

List commands with unresolved owners and their hotspot IDs separately. Identify external-only commands by their external-system IDs. For processes without local state-changing commands, state why no local aggregate is required. If the entire narrative is read-only or external-only, this explanation replaces aggregate rows; do not manufacture a boundary.

### 5. Hotspots and clarification decisions

| Hotspot ID | Affected use-case / scenario / block IDs | Question and modeling impact | Status | Answer / evidence |
| --- | --- | --- | --- | --- |
| UC1-H1 or P1-H1 | UC1, UC1-AS1, P1-C1, P1-G1 as applicable | Precise goal, outcome, rule, or ownership question; what changes depending on the answer | Open, resolved, or deferred | User selection or custom answer; otherwise unknown |

Include unresolved issues and a concise record of decisions resolved during the survey. Preserve IDs from the questions so answers remain traceable. For open or deferred issues, explain which part of the model remains provisional. Do not repeat already answered questions as unresolved. State `No unresolved issues identified in the supplied description and clarifications` when appropriate; do not imply a complete specification.

In interactive mode, this section records the result of step 8; it is not a substitute for actually asking material questions. In non-interactive mode, include the pending questions with reasonable options and custom-answer instructions. State when the user explicitly requested delivery without questions.

## Calibration examples

### Human decision and automatic reaction

Input: "An author submits a draft. The editor sees submitted drafts in a review queue and approves one. After approval, the application automatically publishes it."

Expected decomposition:
- First extract `UC1 — Publish a draft`, covering Author and Editor's journey to publication. Priority is unspecified without a ranking rationale; the independent test follows a draft through submission, editorial approval, and publication.
- `UC1-AS1`: Given an author has a draft, When they submit it, Then it is submitted. `UC1-AS2`: Given a submitted draft in the review queue, When the editor approves it, Then it is approved and automatically published. Trace these scenarios to the commands, events, read model, and policy below; intermediate facts remain distinct.
- One coherent publishing process unless the user provides a separate publishing goal or lifecycle.
- Author issues `Submit Draft`, resulting in `Draft Submitted`.
- `Review Queue` informs Editor; Editor issues `Approve Draft`, resulting in `Draft Approved`.
- Policy: when `Draft Approved`, issue `Publish Draft`; result: `Draft Published`.
- Candidate aggregate `Draft`: inferred root and ownership of submission, approval, and publication state. All three commands provisionally target the same aggregate; reference it in their flows and the aggregate inventory.
- Hotspots: which draft transitions are allowed, what rules govern approval/publication, and whether publication changes draft-owned state or requires a separate owner or external system. Missing rules do not justify omitting the candidate.
- Do not invent a rejection branch, email notification, or approval invariant. Unspecified publication failure behavior can be a hotspot.

### Independent goals and information-only interaction

Input: "The member edits and saves their contact details. Later they open the invoice list and download an existing invoice."

Expected decomposition:
- First extract `UC1 — Update contact details` and `UC2 — Access an existing invoice`, each with its own independent test and Given/When/Then scenarios. No importance ranking is stated; do not treat "Later" as lower priority.
- Map the contact-saving scenario to the state-changing process, and the invoice-access scenario to read-only context. A successful download is an observable acceptance outcome, not automatically a domain event.
- Separate contact-maintenance and invoice-access processes: independent goals and completion conditions.
- First process: Member, `Update Contact Details`, `Contact Details Updated`; candidate aggregate `Member Profile` owns contact details as an explicit inference. Whether these belong to a separate profile or a larger member boundary, and which update rules apply, remain hotspots.
- Second process: Member and `Invoice List`/invoice document information, with download as interaction context and access completion.
- Do not manufacture `Invoice Created`, `Invoice Paid`, or a domain event for downloading unless the user describes an audit or other business consequence.

### Supported aggregate and referenced entity

Input: "The Commander assigns an officer to a mission. Each mission is identified by its mission ID. The mission owns its officer assignments, and assignments may change only while that mission is planned. An accepted assignment produces Officer Assigned."

Expected decomposition:
- Confirmed aggregate `Mission`, rooted in the mission identity, owns its assignment state and enforces the stated invariant: assignments change only while the mission is planned.
- Commander issues `Assign Officer`; Mission handles it; accepted handling produces `Officer Assigned`. Include the same aggregate ID in the catalog, flow, and inventory.
- `Officer` is a referenced business entity, not automatically another aggregate or an internal entity of Mission. The identity/lifecycle of an assignment and the internal representation remain unspecified.
- Do not invent fleet-wide officer availability rules or a rejection event. If the same mission is changed in another process, reuse this aggregate ID.

### Insufficient ownership evidence

Input: "The Commander requests that the application apply the changes."

Expected decomposition:
- First extract provisional `UC1 — Apply changes` with unspecified priority. Its independent test and `UC1-AS1` Then outcome remain `[NEEDS CLARIFICATION: affected state and successful outcome; UC1-H1]`; do not assert that requesting the action proves success.
- Retain `Apply Changes` with unresolved outcome and an unresolved-owner hotspot: what business object and state are being changed?
- Do not fabricate an `Application` aggregate from a generic reference to the software. List this command and its hotspot in the ownership section.

### External-only work

Input: "The Commander asks the external archive service to export an existing mission record. The service reports Record Exported. No local state changes."

Expected decomposition:
- First extract `UC1 — Export a mission record`; its independent test observes the external service's reported export. Trace the Given existing record / When export is requested / Then Record Exported scenario to the external-only process.
- Commander issues `Export Mission Record` to external system `Archive Service`, which reports `Record Exported`.
- The aggregate inventory explains that this path is external-only and references the command and external-system IDs; do not invent a local `Mission Record` aggregate.

### Interactive survey and custom clarification

Input: "The Commander updates a mission briefing. Mission owns the briefing state, but the permitted lifecycle states are not specified."

Expected interaction:
- First extract `UC1 — Update a mission briefing` with an acceptance scenario whose permitted initial mission state is unresolved. After clarification, update the scenario's Given condition, independent-test precondition, and coverage links as well as the model; do not leave the use-case and aggregate invariant contradictory.
- Provisional candidate `Mission`; hotspot `P1-H1` asks which mission states permit `Update Mission Briefing`, rather than asking again who owns the briefing.
- Use `ask` with question ID `P1-H1`: "When may the Commander change a mission briefing?" Offer **Planned only** (briefing cannot change once the mission starts), **Planned or active** (briefing may be revised during execution), and **Keep unresolved** (retain a candidate and an open rule). No recommendation is justified by this narrative. These are alternative proposed rules, not facts.
- Tell the Commander that **Other (type your own)** accepts a custom rule; do not add that option manually to the tool call.
- If the custom answer is "Only while planned; amendments during active missions are a separate procedure," record the planned-only invariant as user clarification, confirm Mission's boundary for this command, and update its catalog, flow, and inventory. Record the separate amendment procedure as context; do not invent its commands or outcomes.
- Mark `P1-H1` resolved and do not ask it again. If a separate outcome hotspot was deferred, keep it deferred rather than declaring the entire process fully specified.

## Version notes

- **1.3**: Extract Spec Kit–style use-cases before EventStorming modeling; add priority rationale, independent tests, Given/When/Then acceptance scenarios, edge cases, and use-case-to-model coverage. Preserve unknowns and propagate clarification decisions through both layers.
