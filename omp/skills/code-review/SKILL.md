---
name: code-review
description: "Orchestrate a code review in OMP: /review requests, 'review this code/PR/changes', re-review after fixes. Delegates to reviewer, conditional specialist lanes, and review-integrator; renders the result in full. Read-only."
---

# Code Review

You orchestrate; you do not review. `reviewer` is the canonical general-review role; criteria and assessment semantics live in `reviewer` and `review-integrator`. Minimize lanes: every lane re-reads the code.

If the user explicitly requests standalone `code-reviewer`, `quality-reviewer`, or `style-reviewer`, route that role as an alternative workflow and preserve its role-specific report. Do not silently substitute it for a `reviewer` slice, add it to the canonical workflow, or force its report into six dimensions. Otherwise follow the canonical workflow below.

## Steps

1. **Target.** Use the supplied target, repository, files, and diff. If missing, obtain the appropriate branch/base/head comparison, `gh pr diff <n>`, or requested staged/unstaged diff. Plain `git diff` covers unstaged tracked changes only; it is not a substitute for a PR/branch/staged comparison. If the target cannot be established, report a blocking gap.
2. **Re-review?** If this session already has a review of this target and the user asks to review again after fixes, run re-review: one `reviewer` over the diff since the last review, with the previous result in "Previous review:". No specialists unless their trigger holds for the new diff.
3. **Reviewer count. Overrides the request's count.** One `reviewer` up to 40 files and 3000 changed lines. Above that, 2-3 reviewers grouped by module, tests with their implementation; never more than 3.
4. **Specialists, only on clear triggers:**
   - `security-reviewer`: auth/authz code, secrets/crypto, deserialization, new external input surface, dependency changes.
   - `api-reviewer`: public API, wire/event schema, or library surface changes.
   - `performance-reviewer`: requirements state performance targets, or the user asks.
   - `verifier`: the user asks to run tests/verify.
   Otherwise "lane not run". Basic security and performance are already covered by `reviewer`.
5. **Integrator** only if more than one lane ran: one `review-integrator` with the same requirements and rules plus complete, unedited lane results.
6. **Report** the adjudicated result with the format below. A failed specification check blocks approval, not the remaining applicable review.

## Assignment

Fill in; add nothing else. Pass the diff once per lane, never the whole request.
```
Target: [mode, base/head or PR, repository]
Files: [assigned files + diff instruction]
Requirements:
[user requirements verbatim, or "none provided"]
Project rules: [paths that exist: AGENTS.md, CONTRIBUTING, testing/style guides]
Other changed files: [paths only]
Verification: [user-requested checks and execution permissions, or "not requested"; identify required proof]
Previous review: [only for re-review]
```

## Forbidden

- Narrowing criteria ("only bugs", "ignore style/nits", own expectations).
- Adding `code-reviewer`, `quality-reviewer`, `style-reviewer`, `architect`, or `critic` as canonical review lanes. Explicit standalone alternatives follow the routing rule above.
- Self-review when a lane fails: report "independent review unavailable" as a blocking gap; never infer approval or a code defect.
- Dropping, downgrading, or re-filtering adjudicated items as the orchestrator; restating generalized lane claims as verified. The integrator owns evidence-based normalization, deduplication, and explained reclassification; pass it complete, unedited lane reports.
- Editing files; running tests or builds outside `verifier`.

## Verdict

Keep three assessments separate: `overall_correctness` (`correct` / `incorrect` / `not_verified`), `review_verdict`, and `verification_status` (`complete` / `partial` / `not_verified`). Evidence completeness refers to assigned checks, not an assertion that runtime tests ran. Style/test-coverage findings alone do not establish behavioral incorrectness.
`verification_status` always uses that enum: `complete` for current/conclusive assigned proof, `partial` for usable proof with gaps, `not_verified` for no usable proof (including a routing-only dry run). "Not requested" describes executable verification in its report section, never an evidence-status value. A static review can have complete evidence without running tests when execution was not required.

Apply disposition in this order:
- REQUEST_CHANGES: confirmed P0–P2 patch findings, classified from impact and evidence—not legacy severity labels.
- BLOCKED: no such finding, but a blocking gap prevents disposition (e.g. an unavailable launched lane, missing required verification, or a failed required check whose patch attribution is unresolved).
- COMMENT: only P3 findings, improvements, non-blocking gaps, or dimensions `concerns`/`not_verified`.
- APPROVE: no findings, improvements, or gaps; complete required evidence; all dimensions `pass`/`not_applicable`. An unmet approval condition is a gap, not a guessed pass.

A verifier FAIL is not automatically a patch finding. Require causal evidence and a patch anchor; otherwise preserve the observed failure and its attribution/limitations as a gap. Pre-existing or environmental failures are not newly introduced defects. Missing proof is never a behavioral FAIL.

## Output

```
## Verdict: [APPROVE / COMMENT / REQUEST_CHANGES / BLOCKED] (confidence x)
[explanation]
Behavioral correctness: [correct / incorrect / not_verified, with scope/evidence boundary]
Verification status: [complete / partial / not_verified; distinguish inspection from execution]
## Dimensions
| Dimension | Status | Evidence |
## Findings
[P#] [kind] title — file:lines
body
## Improvements
[dimension/rule] title — file:lines. Benefit: .. Trade-off: ..
## Gaps
[blocking / non-blocking] title — reason
## Verification
[if executable verification was requested: criterion, exact check/artifact or NOT RUN reason, observed outcome, patch/pre-existing/environmental/unknown attribution, and limitations; if not requested: "not requested"; distinguish requested-but-unavailable from not requested]
## Lanes
[lanes run; "lane not run: reason" for others]
```
Empty sections: "none". No extra commentary.
